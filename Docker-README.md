# 🐳 ZephyrMessenger Server - Docker Deploy

Простая конфигурация Docker для развертывания ZephyrMessenger Server на Selectel Cloud.

## 🚀 Быстрый старт

### 1. Локальная разработка

```bash
# Запуск всех сервисов
docker-compose up -d

# Проверка статуса
docker-compose ps

# Просмотр логов
docker-compose logs -f zephyr-server
```

### 2. Деплой на Selectel

```bash
# Настройка переменных окружения
export SELECTEL_REGISTRY=your-registry.selectel.com
export SELECTEL_PROJECT_ID=your-project-id

# Запуск деплоя
chmod +x deploy-selectel.sh
./deploy-selectel.sh
```

## 📡 Сервисы

- **Backend**: `http://localhost:5000`
- **MongoDB**: `mongodb://localhost:27017`
- **Redis**: `redis://localhost:6379`

## 🔧 Переменные окружения

Создайте файл `.env` на основе `.env.example`:

```bash
# Database
MONGODB_URI=mongodb://zephyr_user:password@mongo:27017/zephyrmessenger
MONGO_ROOT_USERNAME=admin
MONGO_ROOT_PASSWORD=your-secure-password

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# Firebase
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour-Private-Key-Here\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com

# Cloudinary
CLOUDINARY_CLOUD_NAME=your-cloudinary-cloud-name
CLOUDINARY_API_KEY=your-cloudinary-api-key
CLOUDINARY_API_SECRET=your-cloudinary-api-secret

# Redis
REDIS_URL=redis://:your-redis-password@redis:6379
REDIS_PASSWORD=your-redis-password
```

## 🛠️ Управление

### Windows
```bash
# Запуск
start-docker.bat

# Остановка
stop-docker.bat
```

### Linux/Mac
```bash
# Запуск
docker-compose up -d

# Остановка
docker-compose down

# Перезапуск
docker-compose restart
```

## 🔍 Мониторинг

```bash
# Статус контейнеров
docker-compose ps

# Логи сервера
docker-compose logs -f zephyr-server

# Логи MongoDB
docker-compose logs -f mongo

# Логи Redis
docker-compose logs -f redis

# Использование ресурсов
docker stats
```

## 🚨 Устранение неполадок

### Проблемы с портами
```bash
# Проверка занятых портов
netstat -tulpn | grep :5000
netstat -tulpn | grep :27017
netstat -tulpn | grep :6379

# Остановка процессов на портах
sudo fuser -k 5000/tcp
sudo fuser -k 27017/tcp
sudo fuser -k 6379/tcp
```

### Проблемы с Docker
```bash
# Очистка системы
docker system prune -a

# Пересборка образов
docker-compose build --no-cache

# Полная перезагрузка
docker-compose down --volumes
docker-compose up -d
```

### Проблемы с базой данных
```bash
# Подключение к MongoDB
docker-compose exec mongo mongosh -u admin -p password

# Сброс базы данных
docker-compose down --volumes
docker-compose up -d
```

## 📚 Полезные команды

```bash
# Вход в контейнер сервера
docker-compose exec zephyr-server sh

# Вход в MongoDB
docker-compose exec mongo mongosh

# Вход в Redis
docker-compose exec redis redis-cli

# Копирование файлов в контейнер
docker cp local-file.txt zephyr-server:/app/

# Копирование файлов из контейнера
docker cp zephyr-server:/app/logs/app.log ./logs/
```

## 🔒 Безопасность

⚠️ **Важно**:
- Измените все пароли по умолчанию
- Используйте сильные JWT секреты
- Настройте файрвол на сервере
- Регулярно обновляйте образы
- Мониторьте логи на предмет подозрительной активности

## 🌐 Selectel Cloud

После деплоя на Selectel:

1. Настройте Load Balancer (если нужен)
2. Настройте SSL сертификаты
3. Настройте мониторинг
4. Настройте автоматические бэкапы

## 📞 Поддержка

При возникновении проблем:
1. Проверьте логи: `docker-compose logs -f`
2. Проверьте статус: `docker-compose ps`
3. Проверьте ресурсы: `docker stats`
4. Перезапустите сервисы: `docker-compose restart`
