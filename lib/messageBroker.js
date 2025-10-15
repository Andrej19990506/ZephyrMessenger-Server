const Redis = require('ioredis');

class MessageBroker {
  constructor() {
    this.redis = new Redis({
      host: 'localhost',
      port: 6379,
      retryDelayOnFailover: 100,
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
    });

    this.redis.on('connect', () => {
      console.log('✅ [MessageBroker] Redis подключен');
    });

    this.redis.on('error', (err) => {
      console.error('❌ [MessageBroker] Redis ошибка:', err);
    });
  }

  /**
   * 📤 Добавить сообщение в очередь пользователя
   */
  async addMessageToQueue(userId, message) {
    try {
      const queueKey = `user_queue:${userId}`;
      const messageData = JSON.stringify({
        ...message,
        timestamp: Date.now(),
        id: message._id || `msg_${Date.now()}_${Math.random()}`
      });

      // Добавляем в очередь (список)
      await this.redis.lpush(queueKey, messageData);
      
      // Устанавливаем TTL (24 часа)
      await this.redis.expire(queueKey, 86400);
      
      console.log(`📤 [MessageBroker] Сообщение добавлено в очередь для ${userId}`);
      return true;
    } catch (error) {
      console.error('❌ [MessageBroker] Ошибка добавления сообщения:', error);
      return false;
    }
  }

  /**
   * 📥 Получить все сообщения из очереди пользователя
   */
  async getMessagesFromQueue(userId) {
    try {
      const queueKey = `user_queue:${userId}`;
      
      // Получаем все сообщения из очереди
      const messages = await this.redis.lrange(queueKey, 0, -1);
      
      // Парсим JSON
      const parsedMessages = messages.map(msg => JSON.parse(msg));
      
      console.log(`📥 [MessageBroker] Получено ${parsedMessages.length} сообщений для ${userId}`);
      return parsedMessages;
    } catch (error) {
      console.error('❌ [MessageBroker] Ошибка получения сообщений:', error);
      return [];
    }
  }

  /**
   * 🗑️ Очистить очередь пользователя (после получения сообщений)
   */
  async clearUserQueue(userId) {
    try {
      const queueKey = `user_queue:${userId}`;
      await this.redis.del(queueKey);
      console.log(`🗑️ [MessageBroker] Очередь очищена для ${userId}`);
      return true;
    } catch (error) {
      console.error('❌ [MessageBroker] Ошибка очистки очереди:', error);
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

module.exports = messageBroker;
