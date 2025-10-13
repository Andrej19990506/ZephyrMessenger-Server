import express from 'express';
import { 
    registerFCMToken, 
    removeFCMToken, 
    getFCMStatus 
} from '../controllers/fcmController.js';
import { protectRoute } from '../middleware/auth.js';

const router = express.Router();

/**
 * 🔔 Маршруты для Firebase Cloud Messaging
 */

// Регистрация FCM токена
router.post('/register-token', protectRoute, registerFCMToken);

// Удаление FCM токена (при logout)
router.delete('/remove-token', protectRoute, removeFCMToken);

// Проверка статуса FCM
router.get('/status', protectRoute, getFCMStatus);

export default router;


