import express from 'express';
import {
    getUserPublicKey,
    keyExchange,
    generateKeys,
    savePublicKey,
    uploadPreKeyBundle,
    getPreKeyBundle
} from '../controllers/e2eeController.js';
import { protectRoute } from '../middleware/auth.js';

const router = express.Router();

// ==================== PREKEY BUNDLE ROUTES (Signal Protocol) ====================

// Загрузить Prekey Bundle на сервер
router.post('/prekey-bundle', protectRoute, uploadPreKeyBundle);

// Получить Prekey Bundle пользователя
router.get('/prekey-bundle/:userId', protectRoute, getPreKeyBundle);

// ==================== LEGACY ROUTES (для обратной совместимости) ====================

// Получить публичный ключ пользователя
router.get('/user/:id/public-key', protectRoute, getUserPublicKey);

// Сохранить публичный ключ (при инициализации)
router.post('/public-key', protectRoute, savePublicKey);

// Обмен ключами для ECDH
router.post('/key/exchange/:userId', protectRoute, keyExchange);

// Генерировать пару ключей
router.post('/generate-keys', protectRoute, generateKeys);

export default router;
