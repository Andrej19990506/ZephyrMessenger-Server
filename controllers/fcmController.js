import User from "../models/User.js";
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 🔔 Контроллер для работы с Firebase Cloud Messaging
 */

// Инициализация Firebase Admin SDK
let firebaseInitialized = false;

const initializeFirebase = () => {
    if (firebaseInitialized) return;
    
    try {
        let serviceAccount;
        
        // Проверяем наличие сервисного аккаунта (JSON строка или путь к файлу)
        if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            // Если передан JSON строкой
            serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
            // Если передан путь к файлу
            const filePath = path.resolve(__dirname, '..', process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
            const fileContent = fs.readFileSync(filePath, 'utf8');
            serviceAccount = JSON.parse(fileContent);
            console.log('✅ [FCM] Service account загружен из файла:', filePath);
        } else {
            console.warn('⚠️ [FCM] FIREBASE_SERVICE_ACCOUNT или FIREBASE_SERVICE_ACCOUNT_PATH не настроен, FCM отключен');
            return;
        }
        
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        
        firebaseInitialized = true;
        console.log('✅ [FCM] Firebase Admin SDK инициализирован');
    } catch (error) {
        console.error('❌ [FCM] Ошибка инициализации Firebase:', error);
    }
};

// Инициализируем при загрузке модуля
initializeFirebase();

/**
 * 📝 Регистрация FCM токена пользователя
 */
export const registerFCMToken = async (req, res) => {
    try {
        const { fcmToken } = req.body;
        const userId = req.user._id;

        console.log(`🔔 [registerFCMToken] Регистрация FCM токена для пользователя: ${userId}`);

        if (!fcmToken) {
            return res.json({ success: false, message: "FCM токен не предоставлен" });
        }

        // Обновляем FCM токен пользователя
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { fcmToken: fcmToken },
            { new: true }
        );

        if (!updatedUser) {
            return res.json({ success: false, message: "Пользователь не найден" });
        }

        console.log(`✅ [registerFCMToken] FCM токен зарегистрирован для ${updatedUser.name}`);
        res.json({ success: true, message: "FCM токен зарегистрирован" });

    } catch (error) {
        console.error('❌ [registerFCMToken] Ошибка:', error);
        res.json({ success: false, message: error.message });
    }
};

/**
 * 📤 Отправка push-уведомления одному пользователю
 */
export const sendPushNotification = async (userId, notification) => {
    try {
        if (!firebaseInitialized) {
            console.warn('⚠️ [FCM] Firebase не инициализирован, уведомление не отправлено');
            return { success: false, error: 'Firebase не инициализирован' };
        }

        // Получаем FCM токен пользователя
        const user = await User.findById(userId);
        if (!user || !user.fcmToken) {
            console.warn(`⚠️ [FCM] FCM токен не найден для пользователя: ${userId}`);
            return { success: false, error: 'FCM токен не найден' };
        }

        // ⚠️ ВАЖНО: Отправляем ТОЛЬКО data (без notification)
        // Это заставит Android ВСЕГДА вызывать onMessageReceived()
        // даже когда приложение в фоне!
        const message = {
            data: {
                title: notification.title || 'Новое сообщение',
                body: notification.body || '',
                ...(notification.data || {})
            },
            token: user.fcmToken,
            android: {
                priority: 'high' // Высокий приоритет для доставки
            }
        };

        console.log(`📤 [FCM] Отправка data-only уведомления пользователю ${user.name}:`, message.data);

        const response = await admin.messaging().send(message);
        console.log(`✅ [FCM] Уведомление отправлено:`, response);

        return { success: true, response };

    } catch (error) {
        console.error('❌ [FCM] Ошибка отправки уведомления:', error);
        
        // Если токен недействителен, удаляем его
        if (error.code === 'messaging/invalid-registration-token' || 
            error.code === 'messaging/registration-token-not-registered') {
            console.log(`🗑️ [FCM] Удаление недействительного FCM токена для пользователя: ${userId}`);
            await User.findByIdAndUpdate(userId, { fcmToken: null });
        }
        
        return { success: false, error: error.message };
    }
};

/**
 * 🖼️ Преобразование Cloudinary URL для уведомлений (64x64px как в Telegram)
 */
const getNotificationAvatar = (profilePicUrl) => {
    if (!profilePicUrl || profilePicUrl === '') return '';
    
    // Если это Cloudinary URL, добавляем трансформацию для маленького размера
    if (profilePicUrl.includes('cloudinary.com')) {
        // Заменяем /upload/ на /upload/w_64,h_64,c_fill/ для оптимизации
        return profilePicUrl.replace('/upload/', '/upload/w_64,h_64,c_fill,q_auto:low/');
    }
    
    // Для других CDN возвращаем как есть
    return profilePicUrl;
};

/**
 * 📤 Отправка уведомления о новом сообщении
 */
export const sendMessageNotification = async (senderId, receiverId, messageText, isEncrypted = false, encryptedBlob = null) => {
    try {
        // Получаем информацию об отправителе
        const sender = await User.findById(senderId).select('name profilePic');
        if (!sender) {
            console.warn(`⚠️ [FCM] Отправитель не найден: ${senderId}`);
            return;
        }

        const notification = {
            title: sender.name,
            body: isEncrypted ? 'прислал вам новое сообщение 🔒' : messageText,
            data: {
                type: 'message',
                senderId: senderId.toString(),
                senderName: sender.name,
                senderAvatar: getNotificationAvatar(sender.profilePic), // 📸 Маленький аватар 64x64
                message: messageText || '',
                isEncrypted: isEncrypted.toString(),
                encryptedMessage: encryptedBlob ? JSON.stringify(encryptedBlob) : '', // 🔐 ЗАШИФРОВАННОЕ сообщение для расшифровки на устройстве!
                timestamp: Date.now().toString()
            }
        };

        await sendPushNotification(receiverId, notification);

    } catch (error) {
        console.error('❌ [FCM] Ошибка отправки уведомления о сообщении:', error);
    }
};

/**
 * 📤 Отправка уведомления о звонке
 */
export const sendCallNotification = async (callerId, receiverId, callType = 'voice') => {
    try {
        const caller = await User.findById(callerId).select('name profilePic');
        if (!caller) {
            console.warn(`⚠️ [FCM] Звонящий не найден: ${callerId}`);
            return;
        }

        const notification = {
            title: `📞 Входящий ${callType === 'video' ? 'видео' : 'аудио'} звонок`,
            body: `От: ${caller.name}`,
            data: {
                type: 'call',
                callType: callType,
                callerId: callerId.toString(),
                callerName: caller.name,
                callerAvatar: getNotificationAvatar(caller.profilePic), // 📸 Маленький аватар 64x64
                timestamp: Date.now().toString()
            }
        };

        await sendPushNotification(receiverId, notification);

    } catch (error) {
        console.error('❌ [FCM] Ошибка отправки уведомления о звонке:', error);
    }
};

/**
 * 📤 Отправка уведомления о typing indicator
 */
export const sendTypingNotification = async (userId, receiverId, isTyping) => {
    try {
        const user = await User.findById(userId).select('name');
        if (!user) return;

        const notification = {
            data: {
                type: 'typing',
                userId: userId.toString(),
                userName: user.name,
                isTyping: isTyping.toString(),
                timestamp: Date.now().toString()
            }
        };

        // Для typing indicator отправляем только data payload (без notification)
        // чтобы не показывать уведомление пользователю
        const receiver = await User.findById(receiverId);
        if (!receiver || !receiver.fcmToken) return;

        if (firebaseInitialized) {
            await admin.messaging().send({
                data: notification.data,
                token: receiver.fcmToken
            });
        }

    } catch (error) {
        console.error('❌ [FCM] Ошибка отправки typing notification:', error);
    }
};

/**
 * 🗑️ Удаление FCM токена (при logout)
 */
export const removeFCMToken = async (req, res) => {
    try {
        const userId = req.user._id;

        console.log(`🗑️ [removeFCMToken] Удаление FCM токена для пользователя: ${userId}`);

        await User.findByIdAndUpdate(userId, { fcmToken: null });

        console.log(`✅ [removeFCMToken] FCM токен удален`);
        res.json({ success: true, message: "FCM токен удален" });

    } catch (error) {
        console.error('❌ [removeFCMToken] Ошибка:', error);
        res.json({ success: false, message: error.message });
    }
};

/**
 * 📊 Проверка статуса FCM
 */
export const getFCMStatus = async (req, res) => {
    try {
        const userId = req.user._id;
        const user = await User.findById(userId).select('fcmToken');

        res.json({
            success: true,
            hasToken: !!user?.fcmToken,
            firebaseInitialized: firebaseInitialized
        });

    } catch (error) {
        console.error('❌ [getFCMStatus] Ошибка:', error);
        res.json({ success: false, message: error.message });
    }
};


