import Redis from 'ioredis';

class MessageBroker {
  constructor() {
    this.redis = null;
    this.isRedisAvailable = false;
    this.fallbackQueue = new Map(); // Fallback для хранения сообщений в памяти
    
    try {
      this.redis = new Redis({
        host: 'localhost',
        port: 6379,
        retryDelayOnFailover: 100,
        enableReadyCheck: false,
        maxRetriesPerRequest: null,
        lazyConnect: true, // Не подключаемся сразу
      });

      this.redis.on('connect', () => {
        console.log('✅ [MessageBroker] Redis подключен');
        this.isRedisAvailable = true;
      });

      this.redis.on('error', (err) => {
        if (this.isRedisAvailable) { // Логируем только первую ошибку
          console.error('❌ [MessageBroker] Redis ошибка:', err);
          console.warn('⚠️ [MessageBroker] Отключаем Redis, используем fallback');
          this.isRedisAvailable = false;
          
          // Отключаем Redis чтобы он не спамил ошибками
          this.redis.disconnect().catch(() => {});
        }
      });

      // Пытаемся подключиться
      this.redis.connect().catch((error) => {
        if (this.isRedisAvailable) { // Логируем только если еще не отключились
          console.warn('⚠️ [MessageBroker] Redis недоступен, используем fallback:', error.message);
          this.isRedisAvailable = false;
        }
      });
    } catch (error) {
      console.warn('⚠️ [MessageBroker] Redis недоступен, используем fallback:', error.message);
      this.isRedisAvailable = false;
    }
  }

  /**
   * 📤 Добавить сообщение в очередь пользователя
   */
  async addMessageToQueue(userId, message) {
    try {
      const messageData = {
        ...message,
        timestamp: Date.now(),
        id: message._id || `msg_${Date.now()}_${Math.random()}`
      };

      if (this.isRedisAvailable && this.redis) {
        // Используем Redis если доступен
        const queueKey = `user_queue:${userId}`;
        const messageDataJson = JSON.stringify(messageData);
        
        await this.redis.lpush(queueKey, messageDataJson);
        await this.redis.expire(queueKey, 86400); // 24 hours TTL
        
        console.log(`📤 [MessageBroker] Сообщение добавлено в Redis очередь для ${userId}`);
        return true;
      } else {
        // Fallback: используем память
        if (!this.fallbackQueue.has(userId)) {
          this.fallbackQueue.set(userId, []);
        }
        
        const userQueue = this.fallbackQueue.get(userId);
        userQueue.push(messageData);
        
        // Ограничиваем размер очереди (максимум 100 сообщений)
        if (userQueue.length > 100) {
          userQueue.splice(0, userQueue.length - 100);
        }
        
        console.log(`📤 [MessageBroker] Сообщение добавлено в fallback очередь для ${userId} (в памяти)`);
        return true;
      }
    } catch (error) {
      console.error('❌ [MessageBroker] Ошибка добавления сообщения:', error);
      
      // Если Redis упал, переключаемся на fallback
      if (this.isRedisAvailable) {
        console.warn('⚠️ [MessageBroker] Redis упал, переключаемся на fallback');
        this.isRedisAvailable = false;
        
        // Повторяем попытку с fallback
        return this.addMessageToQueue(userId, message);
      }
      
      return false;
    }
  }

  /**
   * 📥 Получить все сообщения из очереди пользователя
   */
  async getMessagesFromQueue(userId) {
    try {
      if (this.isRedisAvailable && this.redis) {
        // Используем Redis если доступен
        const queueKey = `user_queue:${userId}`;
        console.log(`🔍 [MessageBroker] Ищем сообщения в Redis с ключом: ${queueKey}`);
        
        const messages = await this.redis.lrange(queueKey, 0, -1);
        console.log(`🔍 [MessageBroker] Redis вернул ${messages.length} сырых сообщений`);
        
        const parsedMessages = messages.map(msg => JSON.parse(msg));
        
        console.log(`📥 [MessageBroker] Получено ${parsedMessages.length} сообщений из Redis для ${userId}`);
        return parsedMessages;
      } else {
        // Fallback: используем память
        const messages = this.fallbackQueue.get(userId) || [];
        console.log(`📥 [MessageBroker] Получено ${messages.length} сообщений из fallback очереди для ${userId}`);
        return messages;
      }
    } catch (error) {
      console.error('❌ [MessageBroker] Ошибка получения сообщений:', error);
      
      // Если Redis упал, переключаемся на fallback
      if (this.isRedisAvailable) {
        console.warn('⚠️ [MessageBroker] Redis упал при получении, переключаемся на fallback');
        this.isRedisAvailable = false;
        
        // Повторяем попытку с fallback
        return this.getMessagesFromQueue(userId);
      }
      
      return [];
    }
  }

  /**
   * 🗑️ Очистить очередь пользователя (после получения сообщений)
   */
  async clearUserQueue(userId) {
    try {
      if (this.isRedisAvailable && this.redis) {
        // Используем Redis если доступен
        const queueKey = `user_queue:${userId}`;
        await this.redis.del(queueKey);
        console.log(`🗑️ [MessageBroker] Redis очередь очищена для ${userId}`);
        return true;
      } else {
        // Fallback: очищаем память
        this.fallbackQueue.delete(userId);
        console.log(`🗑️ [MessageBroker] Fallback очередь очищена для ${userId}`);
        return true;
      }
    } catch (error) {
      console.error('❌ [MessageBroker] Ошибка очистки очереди:', error);
      
      // Если Redis упал, переключаемся на fallback
      if (this.isRedisAvailable) {
        console.warn('⚠️ [MessageBroker] Redis упал при очистке, переключаемся на fallback');
        this.isRedisAvailable = false;
        
        // Повторяем попытку с fallback
        return this.clearUserQueue(userId);
      }
      
      return false;
    }
  }

  /**
   * 📊 Получить статистику очередей
   */
  async getQueueStats() {
    try {
      const keys = await this.redis.keys('user_queue:*');
      const stats = {};
      
      for (const key of keys) {
        const userId = key.replace('user_queue:', '');
        const length = await this.redis.llen(key);
        stats[userId] = length;
      }
      
      console.log('📊 [MessageBroker] Статистика очередей:', stats);
      return stats;
    } catch (error) {
      console.error('❌ [MessageBroker] Ошибка получения статистики:', error);
      return {};
    }
  }

  /**
   * 🔄 Подписка на новые сообщения (для real-time)
   */
  async subscribeToUserMessages(userId, callback) {
    try {
      const channel = `user_messages:${userId}`;
      
      // Подписываемся на канал
      this.redis.subscribe(channel);
      
      this.redis.on('message', (channel, message) => {
        if (channel === `user_messages:${userId}`) {
          const messageData = JSON.parse(message);
          callback(messageData);
        }
      });
      
      console.log(`🔄 [MessageBroker] Подписка на сообщения для ${userId}`);
      return true;
    } catch (error) {
      console.error('❌ [MessageBroker] Ошибка подписки:', error);
      return false;
    }
  }

  /**
   * 📢 Опубликовать сообщение в канал (для real-time)
   */
  async publishMessage(userId, message) {
    try {
      const channel = `user_messages:${userId}`;
      const messageData = JSON.stringify(message);
      
      await this.redis.publish(channel, messageData);
      console.log(`📢 [MessageBroker] Сообщение опубликовано для ${userId}`);
      return true;
    } catch (error) {
      console.error('❌ [MessageBroker] Ошибка публикации:', error);
      return false;
    }
  }
}

// Создаем единственный экземпляр
const messageBroker = new MessageBroker();

export default messageBroker;
