# 🐳 Dockerfile для ZephyrMessenger Server
# 
# Многоэтапная сборка для оптимизации размера образа
# и безопасности продакшн развертывания

# Этап 1: База для сборки
FROM node:20-alpine AS builder

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci --only=production && npm cache clean --force

# Этап 2: Продакшн образ
FROM node:20-alpine AS production

# Устанавливаем curl для health check
RUN apk add --no-cache curl

# Создаем пользователя для безопасности
RUN addgroup -g 1001 -S nodejs && \
    adduser -S zephyr -u 1001

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем зависимости из builder этапа
COPY --from=builder /app/node_modules ./node_modules

# Копируем исходный код
COPY --chown=zephyr:nodejs . .

# Создаем директории для логов и временных файлов
RUN mkdir -p /app/logs /app/uploads /app/temp && \
    chown -R zephyr:nodejs /app/logs /app/uploads /app/temp

# Переключаемся на непривилегированного пользователя
USER zephyr

# Открываем порты
EXPOSE 5000

# Переменные окружения
ENV NODE_ENV=production
ENV PORT=5000

# Health check (простой)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

# Запускаем приложение
CMD ["node", "server.js"]
