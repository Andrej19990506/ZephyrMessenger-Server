import User from '../models/User.js';
import Message from '../models/Message.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// ==================== PREKEY BUNDLE CONTROLLERS ====================

// POST /api/e2ee/prekey-bundle - Загрузить Prekey Bundle на сервер
export const uploadPreKeyBundle = async (req, res) => {
    try {
        const userId = req.user._id;
        const { identityKey, signedPreKey, oneTimePreKeys } = req.body;

        if (!identityKey || !signedPreKey) {
            return res.status(400).json({ 
                success: false, 
                message: 'Identity key и signed prekey обязательны' 
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'Пользователь не найден' });
        }

        // Сохраняем prekey bundle (libsignal format)
        user.identityKey = identityKey;
        user.signedPreKey = signedPreKey;
        user.oneTimePreKeys = oneTimePreKeys || [];
        
        // Для обратной совместимости сохраняем identity как publicKey
        user.publicKey = identityKey;

        await user.save();

        console.log(`✅ [E2EE] Prekey bundle загружен для пользователя ${user.name}: ${oneTimePreKeys?.length || 0} one-time keys`);

        res.json({ 
            success: true, 
            message: 'Prekey bundle загружен успешно',
            oneTimeKeysCount: user.oneTimePreKeys.length
        });
    } catch (error) {
        console.error('❌ [E2EE] Ошибка загрузки prekey bundle:', error);
        res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
    }
};

// GET /api/e2ee/prekey-bundle/:userId - Получить Prekey Bundle пользователя
export const getPreKeyBundle = async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'Пользователь не найден' });
        }

        if (!user.identityKey) {
            return res.status(404).json({ 
                success: false, 
                message: 'У пользователя нет prekey bundle. Попросите его залогиниться.' 
            });
        }

        // Берем один one-time ключ (если есть) и удаляем его
        let oneTimePreKey = null;
        if (user.oneTimePreKeys && user.oneTimePreKeys.length > 0) {
            oneTimePreKey = user.oneTimePreKeys[0];
            // Удаляем использованный one-time ключ (Perfect Forward Secrecy!)
            user.oneTimePreKeys.splice(0, 1);
            await user.save();
            
            console.log(`🔑 [E2EE] Выдан one-time prekey ID ${oneTimePreKey.keyId} для ${user.name}. Осталось: ${user.oneTimePreKeys.length}`);
        } else {
            console.log(`⚠️ [E2EE] У ${user.name} закончились one-time prekeys! Используем только signed prekey.`);
        }

        const bundle = {
            identityKey: user.identityKey, // libsignal Curve25519 format (33 bytes with 0x05 prefix)
            signedPreKey: user.signedPreKey,
            oneTimePreKey
        };

        res.json({
            success: true,
            bundle
        });
    } catch (error) {
        console.error('❌ [E2EE] Ошибка получения prekey bundle:', error);
        res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
    }
};

// POST /api/e2ee/public-key - Сохранить публичный ключ пользователя (deprecated, для обратной совместимости)
export const savePublicKey = async (req, res) => {
    try {
        const { publicKey } = req.body;
        const userId = req.user._id;

        if (!publicKey) {
            return res.status(400).json({ success: false, message: 'Публичный ключ не предоставлен' });
        }

        // Обновляем публичный ключ пользователя
        const user = await User.findById(userId);
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'Пользователь не найден' });
        }

        user.publicKey = publicKey;
        await user.save();

        res.json({
            success: true,
            message: 'Публичный ключ сохранен успешно'
        });

    } catch (error) {
        console.error('Ошибка сохранения публичного ключа:', error);
        res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
    }
};

// GET /api/user/:id/public-key - Получить публичный ключ пользователя
export const getUserPublicKey = async (req, res) => {
    try {
        const { id } = req.params;

        // Находим целевого пользователя
        const targetUser = await User.findById(id);
        
        if (!targetUser) {
            return res.status(404).json({ success: false, message: 'Пользователь не найден' });
        }

        if (!targetUser.publicKey) {
            return res.status(404).json({ success: false, message: 'Публичный ключ пользователя не найден' });
        }

        res.json({
            success: true,
            publicKey: targetUser.publicKey,
            userId: targetUser._id
        });

    } catch (error) {
        console.error('Ошибка получения публичного ключа:', error);
        res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
    }
};

// POST /api/key/exchange/:userId - Обмен ключами для ECDH
export const keyExchange = async (req, res) => {
    try {
        const { userId } = req.params;
        const { publicKey } = req.body;
        const currentUserId = req.user._id;

        if (!publicKey) {
            return res.status(400).json({ success: false, message: 'Публичный ключ не предоставлен' });
        }

        // Находим текущего пользователя
        const currentUser = await User.findById(currentUserId);
        
        if (!currentUser) {
            return res.status(404).json({ success: false, message: 'Пользователь не найден' });
        }

        // Находим целевого пользователя
        const targetUser = await User.findById(userId);
        
        if (!targetUser) {
            return res.status(404).json({ success: false, message: 'Пользователь не найден' });
        }

        // Сохраняем публичный ключ текущего пользователя
        currentUser.publicKey = publicKey;
        await currentUser.save();

        // Возвращаем публичный ключ целевого пользователя
        res.json({
            success: true,
            targetPublicKey: targetUser.publicKey || null,
            message: 'Обмен ключами выполнен успешно'
        });

    } catch (error) {
        console.error('Ошибка обмена ключами:', error);
        res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
    }
};

// POST /api/e2ee/generate-keys - Генерировать пару ключей для пользователя
export const generateKeys = async (req, res) => {
    try {
        const currentUserId = req.user._id;

        // Находим текущего пользователя
        const currentUser = await User.findById(currentUserId);
        
        if (!currentUser) {
            return res.status(401).json({ success: false, message: 'Неверный токен' });
        }

        // Генерируем пару ключей ECDH
        const keyPair = crypto.generateKeyPairSync('ec', {
            namedCurve: 'prime256v1',
            publicKeyEncoding: {
                type: 'spki',
                format: 'pem'
            },
            privateKeyEncoding: {
                type: 'pkcs8',
                format: 'pem'
            }
        });

        // Сохраняем публичный ключ
        currentUser.publicKey = keyPair.publicKey;
        await currentUser.save();

        res.json({
            success: true,
            publicKey: keyPair.publicKey,
            privateKey: keyPair.privateKey, // Временно возвращаем для инициализации
            message: 'Ключи сгенерированы успешно'
        });

    } catch (error) {
        console.error('Ошибка генерации ключей:', error);
        res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
    }
};
