import User from "../models/User.js";
import bcrypt from "bcryptjs";
import { generateToken } from "../lib/utils.js";
import cloudinary from "../lib/cloudinary.js";
import multer from 'multer';
import admin from 'firebase-admin';

// Настройка multer для обработки файлов в памяти
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB максимум
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Только изображения разрешены'), false);
        }
    }
});

// Middleware для обработки одного файла
export const uploadProfilePic = upload.single('profilePic');

//signup new user
export const signup = async (req, res) => {
    const {email, name, password, bio, username} = req.body;
    
    console.log(`👤 [signup] Регистрация нового пользователя:`, {
        email, name, bio, username,
        hasUsername: !!username,
        usernameLength: username ? username.length : 0
    });
    
    try {
        // 🚀 УПРОЩЕННАЯ РЕГИСТРАЦИЯ - bio опциональный
        if(!email || !name || !password){
            return res.json({success: false, message: "Missing details"});
        }
        
        // Проверяем уникальность email
        const existingUserByEmail = await User.findOne({email});
        if(existingUserByEmail){
            return res.json({success: false, message: "User with this email already exists"});
        }
        
        // Проверяем уникальность username если он предоставлен
        if(username) {
            const existingUserByUsername = await User.findOne({username});
            if(existingUserByUsername){
                return res.json({success: false, message: "Username already taken"});
            }
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = await User.create({
            email, 
            name, 
            password: hashedPassword, 
            bio: bio || '', // Bio опциональный, пустая строка по умолчанию
            username
        });

        const token = generateToken(newUser._id);

        res.json({success: true, userData: newUser, message: "User created successfully", token});
        } catch (error) {
        console.log(error);
        res.json({success: false, message: error.message});
    }
}

 //controller to login user (по username вместо email)
export const login = async (req, res) => {
    try {
        const {username, password} = req.body;
        
        console.log(`🔐 [login] Попытка входа:`, { username });
        
        // Ищем пользователя по username
        const userData = await User.findOne({username});

        if(!userData){
            console.log(`❌ [login] Пользователь не найден:`, username);
            return res.json({success: false, message: "Пользователь не найден"});
        }

        const isPasswordCorrect = await bcrypt.compare(password, userData.password);

        if(!isPasswordCorrect){
            console.log(`❌ [login] Неверный пароль для:`, username);
            return res.json({success: false, message: "Неверный пароль"});
        }

        const token = generateToken(userData._id);
        console.log(`✅ [login] Успешный вход:`, userData.name);
        res.json({success: true, userData, message: "User logged in successfully", token});
    }   catch (error) {
        console.log(`❌ [login] Ошибка:`, error);
        res.json({success: false, message: error.message});
    }
 }

 //controller to check if user is authenticated
 export const checkAuth = async (req, res) => {
    res.json({success: true, user: req.user, message: "User is authenticated"});
 }

 //controller to update user profile
export const updateUserProfile = async (req, res) => {
    try {
        const {name, bio, username, profilePic} = req.body;
        const userid = req.user._id;
        let updatedUser;

        console.log(`👤 [updateUserProfile] Обновление профиля для пользователя: ${userid}`);
        console.log(`👤 [updateUserProfile] Данные для обновления:`, {
            name, bio, username, profilePic,
            hasUsername: !!username,
            usernameLength: username ? username.length : 0
        });

        // Проверяем уникальность username если он предоставлен
        if(username) {
            const existingUserByUsername = await User.findOne({username, _id: {$ne: userid}});
            if(existingUserByUsername){
                return res.json({success: false, message: "Username already taken"});
            }
        }

        // Проверяем, нужно ли удалить фото профиля
        if (profilePic === 'DELETE_PROFILE_PIC') {
            console.log(`🗑️ [updateUserProfile] Удаление фото профиля`);
            updatedUser = await User.findByIdAndUpdate(
                userid, 
                {name, bio, username, profilePic: ''}, 
                {new: true}
            );
        } else if (!req.file) {
            // Если изображение не загружено, обновляем только текст
            console.log(`👤 [updateUserProfile] Обновление без изображения`);
            updatedUser = await User.findByIdAndUpdate(userid, {name, bio, username}, {new: true});
        } else {
            // Обрабатываем изображение
            console.log(`👤 [updateUserProfile] Обработка изображения:`, {
                originalname: req.file.originalname,
                mimetype: req.file.mimetype,
                size: req.file.size
            });
            
            // Загружаем файл напрямую в Cloudinary без конвертации в base64
            const uploadResult = await new Promise((resolve, reject) => {
                cloudinary.uploader.upload_stream(
                    {
                        resource_type: 'auto',
                        quality: 90, // Высокое качество (0-100)
                        fetch_format: 'auto', // Автоматический выбор формата
                        width: 200, // Оптимальный размер аватарки
                        height: 200, // Оптимальный размер аватарки
                        crop: 'fill', // Заполнение контейнера
                        gravity: 'face', // Фокус на лицах для аватарок
                    },
                    (error, result) => {
                        if (error) {
                            console.error('❌ [updateUserProfile] Ошибка загрузки в Cloudinary:', error);
                            reject(error);
                        } else {
                            console.log('✅ [updateUserProfile] Изображение загружено в Cloudinary:', result.secure_url);
                            resolve(result);
                        }
                    }
                ).end(req.file.buffer);
            });
            
            updatedUser = await User.findByIdAndUpdate(
                userid, 
                {name, bio, username, profilePic: uploadResult.secure_url}, 
                {new: true}
            );
        }
        
        console.log(`✅ [updateUserProfile] Профиль успешно обновлен`);
        
        // 🔥 Отправляем событие обновления профиля только контактам (с кем есть сообщения)
        const { io, userSocketMap } = await import('../server.js');
        const Message = (await import('../models/Message.js')).default;
        
        // Находим всех пользователей, с которыми есть переписка
        const contacts = await Message.aggregate([
            {
                $match: {
                    $or: [
                        { senderId: updatedUser._id },
                        { receiverId: updatedUser._id }
                    ]
                }
            },
            {
                $group: {
                    _id: null,
                    userIds: {
                        $addToSet: {
                            $cond: [
                                { $eq: ["$senderId", updatedUser._id] },
                                "$receiverId",
                                "$senderId"
                            ]
                        }
                    }
                }
            }
        ]);
        
        if (contacts.length > 0 && contacts[0].userIds.length > 0) {
            const contactIds = contacts[0].userIds.map(id => id.toString());
            console.log(`📡 [updateUserProfile] Отправка обновления профиля ${contactIds.length} контактам`);
            
            // Отправляем только онлайн контактам
            contactIds.forEach(contactId => {
                const socketId = userSocketMap[contactId];
                if (socketId) {
                    io.to(socketId).emit('profileUpdated', {
                        userId: updatedUser._id.toString(),
                        name: updatedUser.name,
                        username: updatedUser.username,
                        profilePic: updatedUser.profilePic,
                        bio: updatedUser.bio
                    });
                }
            });
            
            console.log('✅ [updateUserProfile] Событие profileUpdated отправлено контактам');
        } else {
            console.log('📡 [updateUserProfile] Нет контактов для отправки обновления');
        }
        
        res.json({success: true, user: updatedUser, message: "User updated successfully"});
        
    } catch (error) {
        console.log(`❌ [updateUserProfile] Ошибка:`, error);
        res.json({success: false, message: error.message});
    }
}

//controller to search users by username
export const searchUsersByUsername = async (req, res) => {
    try {
        const {username} = req.query;
        const currentUserId = req.user._id;
        
        console.log(`🔍 [searchUsersByUsername] Поиск пользователей по username: ${username}`);
        
        if (!username || username.trim().length < 2) {
            return res.json({success: false, message: "Username must be at least 2 characters long"});
        }
        
        // Ищем пользователей по username (регистронезависимый поиск)
        const users = await User.find({
            username: { $regex: username, $options: 'i' },
            _id: { $ne: currentUserId } // Исключаем текущего пользователя
        }).select("-password").limit(10);
        
        console.log(`🔍 [searchUsersByUsername] Найдено ${users.length} пользователей`);
        
        res.json({success: true, users, message: `Found ${users.length} users`});
        
    } catch (error) {
        console.log(`❌ [searchUsersByUsername] Ошибка:`, error);
        res.json({success: false, message: error.message});
    }
}

//controller to delete user account
export const deleteUserAccount = async (req, res) => {
    try {
        const {password} = req.body;
        const userId = req.user._id;

        console.log('🗑️ [Delete Account] Запрос удаления аккаунта:', { userId, password: password ? 'provided' : 'missing' });

        // Находим пользователя
        const user = await User.findById(userId);
        if (!user) {
            console.log('❌ [Delete Account] Пользователь не найден:', userId);
            return res.json({success: false, message: "Пользователь не найден"});
        }

        console.log('✅ [Delete Account] Пользователь найден:', user.name);

        // ⚠️ ДЛЯ ТЕСТИРОВАНИЯ: Пропускаем проверку пароля если пароль не передан
        if (password) {
            // Проверяем пароль только если он передан
            const isPasswordCorrect = await bcrypt.compare(password, user.password);
            console.log('🔑 [Delete Account] Проверка пароля:', isPasswordCorrect);
            
            if (!isPasswordCorrect) {
                console.log('❌ [Delete Account] Неверный пароль для:', user.name);
                return res.json({success: false, message: "Неверный пароль"});
            }
        } else {
            console.log('⚠️ [Delete Account] ТЕСТОВЫЙ РЕЖИМ: Удаление без пароля');
        }

        // Удаляем пользователя
        const deletedUser = await User.findByIdAndDelete(userId);
        console.log('🗑️ [Delete Account] Пользователь удален:', deletedUser ? deletedUser.name : 'failed');

        res.json({success: true, message: "Аккаунт успешно удален"});
        
    } catch (error) {
        console.log('❌ [Delete Account] Ошибка удаления аккаунта:', error);
        res.json({success: false, message: error.message});
    }
}

//controller to get user by ID
export const getUserById = async (req, res) => {
    try {
        const { userId } = req.params;
        
        console.log(`👤 [getUserById] Получение пользователя по ID: ${userId}`);
        
        const user = await User.findById(userId).select("-password");
        
        if (!user) {
            console.log(`❌ [getUserById] Пользователь не найден: ${userId}`);
            return res.json({success: false, message: "User not found"});
        }
        
        console.log(`✅ [getUserById] Пользователь найден: ${user.name}`);
        res.json({success: true, user});
        
    } catch (error) {
        console.log('Error in getUserById:', error);
        res.json({success: false, message: error.message});
    }
}

// Проверка зарегистрированных номеров телефонов
export const checkPhoneNumbers = async (req, res) => {
    try {
        const { phoneNumbers } = req.body;
        
        console.log(`📞 [checkPhoneNumbers] Проверка ${phoneNumbers?.length || 0} номеров`);
        
        if (!phoneNumbers || !Array.isArray(phoneNumbers)) {
            return res.json({success: false, message: "Phone numbers array is required"});
        }
        
        // Нормализуем номера (убираем пробелы, дефисы и т.д.)
        const normalizedPhones = phoneNumbers.map(phone => 
            phone.replace(/[\s\-\(\)]/g, '')
        );
        
        // Ищем пользователей с этими номерами
        // Предполагаем, что в модели User есть поле phoneNumber
        const registeredUsers = await User.find({
            username: { $in: normalizedPhones }
        }).select('username name profilePic _id');
        
        // Создаем map зарегистрированных номеров
        const registeredPhones = registeredUsers.map(user => ({
            phoneNumber: user.username,
            userId: user._id,
            name: user.name,
            profilePic: user.profilePic
        }));
        
        console.log(`✅ [checkPhoneNumbers] Найдено ${registeredPhones.length} зарегистрированных пользователей`);
        
        res.json({
            success: true, 
            registeredPhones,
            total: phoneNumbers.length,
            registered: registeredPhones.length
        });
        
    } catch (error) {
        console.log('❌ [checkPhoneNumbers] Ошибка проверки номеров:', error);
        res.json({success: false, message: error.message});
    }
}

// 📞 Проверка доступности номера телефона
export const checkPhoneAvailability = async (req, res) => {
    const { phoneNumber } = req.body;
    
    console.log(`📞 [checkPhoneAvailability] Проверка номера:`, phoneNumber);
    
    try {
        if (!phoneNumber) {
            return res.json({
                success: false, 
                message: "Номер телефона обязателен"
            });
        }

        // Ищем пользователя с таким номером
        const existingUser = await User.findOne({ phoneNumber: phoneNumber });

        if (existingUser) {
            console.log(`⚠️ [checkPhoneAvailability] Номер занят - требуется восстановление`);
            return res.json({
                success: false,
                isRegistered: true,
                needsAction: true,
                message: "Этот номер уже зарегистрирован",
                details: "Восстановите данные из резервной копии"
            });
        } else {
            console.log(`✅ [checkPhoneAvailability] Номер свободен - можно регистрироваться`);
            return res.json({
                success: true,
                isRegistered: false,
                needsAction: false,
                message: "Номер доступен для регистрации"
            });
        }

    } catch (error) {
        console.log('❌ [checkPhoneAvailability] Ошибка проверки номера:', error);
        res.json({
            success: false,
            message: error.message || "Ошибка проверки номера"
        });
    }
};

// 📱 Phone Auth - регистрация/вход через Firebase Phone Auth  
export const phoneAuth = async (req, res) => {
    const { firebaseIdToken, phoneNumber, uid, name, username, password, profilePic } = req.body;
    
    console.log(`📱 [phoneAuth] Phone Auth запрос:`, {
        hasFirebaseToken: !!firebaseIdToken,
        phoneNumber,
        uid
    });
    
    try {
        if (!firebaseIdToken || !phoneNumber || !uid) {
            return res.json({
                success: false, 
                message: "Отсутствуют обязательные поля"
            });
        }

        // Верифицируем Firebase ID токен
        let decodedToken;
        try {
            decodedToken = await admin.auth().verifyIdToken(firebaseIdToken);
            console.log(`✅ [phoneAuth] Firebase токен верифицирован:`, {
                uid: decodedToken.uid,
                phoneNumber: decodedToken.phone_number
            });
        } catch (firebaseError) {
            console.log('❌ [phoneAuth] Ошибка верификации Firebase токена:', firebaseError);
            return res.json({
                success: false,
                message: "Неверный Firebase токен"
            });
        }

        // Проверяем, что UID совпадает
        if (decodedToken.uid !== uid) {
            return res.json({
                success: false,
                message: "UID не совпадает"
            });
        }

        // Проверяем, что номер телефона совпадает
        if (decodedToken.phone_number !== phoneNumber) {
            return res.json({
                success: false,
                message: "Номер телефона не совпадает"
            });
        }

        // Ищем существующего пользователя по phoneNumber или Firebase UID
        let user = await User.findOne({
            $or: [
                { phoneNumber: phoneNumber },
                { firebaseUid: uid }
            ]
        });

        if (user) {
            // ⚠️ КРИТИЧНО: Пользователь с этим номером уже существует!
            // Блокируем регистрацию - можно только восстановить из бэкапа
            console.log(`⚠️ [phoneAuth] Номер уже зарегистрирован, блокируем регистрацию:`, phoneNumber);
            return res.json({
                success: false,
                accountExists: true,
                message: "Этот номер уже зарегистрирован на другом устройстве",
                details: "Восстановите данные из резервной копии"
            });
        } else {
            // Создаем нового пользователя с данными из ProfileSetup
            const finalUsername = username || phoneNumber.replace('+', '');
            const finalName = name || `Пользователь ${finalUsername}`;
            const finalPassword = password || 'phone-auth'; // Если пароль не передан, используем заглушку
            
            // Хешируем пароль если он передан
            const hashedPassword = password ? await bcrypt.hash(password, 12) : 'phone-auth';
            
            user = new User({
                name: finalName,
                username: finalUsername,
                email: `${finalUsername}@phone.local`, // Генерируем email
                phoneNumber: phoneNumber,
                firebaseUid: uid,
                password: hashedPassword,
                bio: '',
                profilePic: '', // Пока пусто, загрузка будет через update-profile
                isVerified: true // Phone Auth автоматически верифицирует
            });

            await user.save();
            console.log(`✅ [phoneAuth] Создан новый пользователь:`, {
                id: user._id,
                name: user.name,
                phoneNumber: user.phoneNumber
            });
        }

        // Генерируем JWT токен
        const token = generateToken(user._id);
        
        console.log(`✅ [phoneAuth] Успешная авторизация:`, {
            userId: user._id,
            phoneNumber: user.phoneNumber
        });

        res.json({
            success: true,
            message: "Успешная авторизация через телефон",
            token: token,
            user: {
                _id: user._id,
                name: user.name,
                username: user.username,
                email: user.email,
                phoneNumber: user.phoneNumber,
                profilePic: user.profilePic,
                bio: user.bio,
                isVerified: user.isVerified
            }
        });

    } catch (error) {
        console.log('❌ [phoneAuth] Ошибка Phone Auth:', error);
        res.json({
            success: false,
            message: error.message || "Ошибка авторизации через телефон"
        });
    }
}