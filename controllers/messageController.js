import User from "../models/User.js";
import Message from "../models/Message.js";
import cloudinary from "../lib/cloudinary.js";
import { io, userSocketMap} from "../server.js";
// Шифрование теперь происходит на клиенте (E2EE)
import multer from 'multer';
import { sendMessageNotification } from './fcmController.js';

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
export const uploadSingle = upload.single('image');



//Get only users with whom the logged in user has messages
export const getUsersForSidebar = async (req, res) => {
    try {
       const userId = req.user._id;
       
       // Находим всех пользователей, с которыми есть сообщения
       const messagesWithUsers = await Message.aggregate([
           {
               $match: {
                   $or: [
                       {senderId: userId},
                       {receiverId: userId}
                   ]
               }
           },
           {
               $group: {
                   _id: null,
                   userIds: {
                       $addToSet: {
                           $cond: [
                               { $eq: ["$senderId", userId] },
                               "$receiverId",
                               "$senderId"
                           ]
                       }
                   }
               }
           }
       ]);

       // Если нет сообщений, возвращаем пустой список
       if (!messagesWithUsers.length || !messagesWithUsers[0].userIds.length) {
           return res.json({success: true, users: [], unseenMessages: {}, lastMessages: {}});
       }

       // Получаем информацию о пользователях
       const filteredUsers = await User.find({
           _id: { $in: messagesWithUsers[0].userIds }
       }).select("-password");

       console.log(`👥 [getUsersForSidebar] Найдено ${filteredUsers.length} пользователей с сообщениями:`, 
           filteredUsers.map(user => ({ name: user.name, username: user.username, id: user._id })));

       //count number of messages  not seen and get last messages
       const unseenMessages = {}
       const lastMessages = {}
       const promises = filteredUsers.map(async (user) => {
        // Count unseen messages
        const unseenMsgs = await Message.find({senderId: user._id, receiverId: userId, seen: false});
        if(unseenMsgs.length > 0){
            unseenMessages[user._id] = unseenMsgs.length;
        }
        
        // Get last message between current user and this user
        const lastMessage = await Message.findOne({
            $or: [
                {senderId: userId, receiverId: user._id},
                {senderId: user._id, receiverId: userId}
            ]
        }).sort({createdAt: -1});
        
        if(lastMessage) {
            // E2EE: Сообщения теперь расшифровываются на клиенте
            const messageObj = lastMessage.toObject();
            lastMessages[user._id] = messageObj;
        }
       })
       await Promise.all(promises);
       res.json({success: true, users: filteredUsers, unseenMessages, lastMessages});
    } catch (error) {
        console.log(error);
        res.json({success: false, message: error.message});
    }
}

//Get all messages for a user
export const getMessages = async (req, res) => {
    try {
        const {id:selectedUserId} = req.params;
        const myId = req.user._id;

        console.log(`📨 [getMessages] Получение сообщений для пользователя ${selectedUserId} от ${myId}`);

        const messages = await Message.find({
            $or: [
                {senderId: myId, receiverId: selectedUserId},
                {senderId: selectedUserId, receiverId: myId}
            ]
        })

        // НЕ помечаем все сообщения как прочитанные автоматически
        // Это будет происходить только при реальном прочтении

        // E2EE: Отправляем сообщения как есть, расшифровка происходит на клиенте
        const processedMessages = messages.map(message => message.toObject());

        // Получаем позицию скролла для этого чата
        const user = await User.findById(myId);
        const scrollPosition = user.scrollPositions?.get(selectedUserId) || 0;

        console.log(`📨 [getMessages] Найдено ${messages.length} сообщений, позиция скролла: ${scrollPosition}`);

        res.json({success: true, messages: processedMessages, scrollPosition});
    } catch (error) {
        console.log(`❌ [getMessages] Ошибка:`, error);
        res.json({success: false, message: error.message});
    }
}

//api to mark a message as seen using message id

export const markMessageAsSeen = async (req, res) => {
    try {
        const {id} = req.params;
        await Message.findByIdAndUpdate(id, {seen: true});
        res.json({success: true, message: "Message marked as seen"});
    } catch (error) {
        console.log(error);
        res.json({success: false, message: error.message});
    }
}

//api to mark all messages from a specific user as seen
export const markMessagesAsSeen = async (req, res) => {
    try {
        const {userId} = req.params;
        const myId = req.user._id;
        
        console.log(`👁️ [markMessagesAsSeen] Пометка сообщений как прочитанных от ${userId} для ${myId}`);
        
        // Помечаем все сообщения от выбранного пользователя как прочитанные
        await Message.updateMany(
            {senderId: userId, receiverId: myId, seen: false}, 
            {seen: true}
        );
        
        res.json({success: true, message: "Messages marked as seen"});
    } catch (error) {
        console.log(`❌ [markMessagesAsSeen] Ошибка:`, error);
        res.json({success: false, message: error.message});
    }
}

//api to delete all messages with a specific user
export const deleteChatWithUser = async (req, res) => {
    try {
        const {userId} = req.params;
        const myId = req.user._id;
        
        console.log(`🗑️ [deleteChatWithUser] Удаление чата с пользователем ${userId} для ${myId}`);
        
        // Удаляем все сообщения между пользователями (в обе стороны)
        const result = await Message.deleteMany({
            $or: [
                {senderId: myId, receiverId: userId},
                {senderId: userId, receiverId: myId}
            ]
        });
        
        console.log(`✅ [deleteChatWithUser] Удалено ${result.deletedCount} сообщений`);
        
        // Отправляем событие через WebSocket для обновления UI у обоих пользователей
        const receiverSocketId = userSocketMap[userId];
        if(receiverSocketId){
            console.log(`📡 [deleteChatWithUser] Отправка события удаления чата получателю`);
            console.log(`📡 [deleteChatWithUser] Данные события:`, {
                deletedBy: myId,
                deletedWith: userId,
                deletedByString: myId.toString(),
                deletedWithString: userId.toString()
            });
            io.to(receiverSocketId).emit("chatDeleted", {
                deletedBy: myId,
                deletedWith: userId
            });
        }
        
        res.json({
            success: true, 
            message: `Chat deleted successfully. ${result.deletedCount} messages removed.`,
            deletedCount: result.deletedCount
        });
    } catch (error) {
        console.log(`❌ [deleteChatWithUser] Ошибка:`, error);
        res.json({success: false, message: error.message});
    }
}

// Send a message to selected user
export const sendMessage = async (req, res) => {
    try {
        const{text, blob} = req.body; // Добавляем поддержку blob
        const receiverId = req.params.id;
        const senderId = req.user._id;

        console.log(`📤 [sendMessage] Отправка сообщения от ${senderId} к ${receiverId}`);

        let imageUrl = null;
        let messageData = null;

        // E2EE: Если пришел blob, сохраняем его как есть без расшифровки
        if(blob) {
            console.log(`🔐 [sendMessage] Получен E2EE blob от клиента`);
            messageData = blob;
        }
        else if(text && text.trim()) {
            console.log(`📝 [sendMessage] Получен обычный текст от клиента`);
            messageData = text;
        }

        // Обрабатываем изображение если оно есть
        if (req.file) {
            console.log(`📷 [sendMessage] Обработка изображения:`, {
                originalname: req.file.originalname,
                mimetype: req.file.mimetype,
                size: req.file.size
            });
            
            // Загружаем файл напрямую в Cloudinary без конвертации в base64
            imageUrl = await new Promise((resolve, reject) => {
                cloudinary.uploader.upload_stream(
                    {
                        resource_type: 'auto',
                        quality: 85, // Высокое качество для сообщений
                        fetch_format: 'auto', // Автоматический выбор формата
                        width: 1200, // Максимальная ширина для изображений в чате
                        height: 1200, // Максимальная высота для изображений в чате
                        crop: 'limit', // Ограничение размера без обрезки
                    },
                    (error, result) => {
                        if (error) {
                            console.error('❌ [sendMessage] Ошибка загрузки в Cloudinary:', error);
                            reject(error);
                        } else {
                            console.log('✅ [sendMessage] Изображение загружено в Cloudinary:', result.secure_url);
                            resolve(result.secure_url);
                        }
                    }
                ).end(req.file.buffer);
            });
        }

        // Создаем сообщение
        const newMessage = await Message.create({
            text: blob ? '' : messageData, // E2EE: очищаем text для зашифрованных сообщений
            encryptedBlob: blob || undefined, // E2EE: сохраняем blob в отдельном поле
            encrypted: !!blob, // E2EE blob всегда зашифрован
            image: imageUrl, 
            senderId, 
            receiverId
        });

        // Подготавливаем сообщение для отправки клиенту
        const messageForClient = newMessage.toObject();
        
        // E2EE: Если это blob, отправляем как есть
        // E2EE: Отправляем сообщение как есть, расшифровка происходит на клиенте
        console.log(`📡 [sendMessage] Отправляем сообщение клиенту как есть`);

        // Получаем данные отправителя для отправки вместе с сообщением
        const senderUser = await User.findById(senderId).select('name username profilePic');
        
        //Emit the message to the receiver`s socket
        const receiverSocketId = userSocketMap[receiverId];
        if(receiverSocketId){
            console.log(`📡 [sendMessage] Отправка сообщения через WebSocket получателю`);
            // Отправляем сообщение вместе с данными отправителя
            io.to(receiverSocketId).emit("newMessage", {
                message: messageForClient,
                sender: {
                    _id: senderUser._id,
                    name: senderUser.name,
                    username: senderUser.username,
                    profilePic: senderUser.profilePic
                }
            });
        } else {
            // Если получатель offline, отправляем push-уведомление
            console.log(`📱 [sendMessage] Получатель offline, отправка push-уведомления`);
            const isEncrypted = !!blob;
            const notificationText = imageUrl ? '📷 Изображение' : (text || '');
            sendMessageNotification(senderId, receiverId, notificationText, isEncrypted);
        }

        console.log(`✅ [sendMessage] Сообщение успешно отправлено и сохранено в БД`);
        res.json({success: true, message: messageForClient});
    } catch (error) {
        console.log(`❌ [sendMessage] Ошибка:`, error);
        res.json({success: false, message: error.message});
    }
}

//Delete message
export const deleteMessage = async (req, res) => {
    try {
        const {id:messageId} = req.params;
        const myId = req.user._id;

        const message = await Message.findById(messageId);
        if(!message) {
            return res.json({success: false, message: "Message not found"});
        }

        // Проверяем, что пользователь может удалить сообщение (только свои сообщения)
        if(message.senderId.toString() !== myId.toString()) {
            return res.json({success: false, message: "Unauthorized"});
        }

        await Message.findByIdAndDelete(messageId);
        
        // Отправляем событие удаления через WebSocket
        const receiverSocketId = userSocketMap[message.receiverId.toString()];
        if(receiverSocketId){
            io.to(receiverSocketId).emit("messageDeleted", {messageId});
        }
        
        res.json({success: true, message: "Message deleted successfully"});
    } catch (error) {
        console.log(error);
        res.json({success: false, message: error.message});
    }
}

export const addReaction = async (req, res) => {
    try {
        const {messageId} = req.params;
        const {emoji} = req.body;
        const userId = req.user._id;

        const message = await Message.findById(messageId);
        if(!message) {
            return res.json({success: false, message: "Message not found"});
        }

        // Проверяем, есть ли уже реакция от этого пользователя с этим эмодзи
        const existingReaction = message.reactions.find(
            reaction => reaction.userId.toString() === userId.toString() && reaction.emoji === emoji
        );

        if(existingReaction) {
            // Удаляем существующую реакцию (клик по своей реакции)
            message.reactions = message.reactions.filter(
                reaction => !(reaction.userId.toString() === userId.toString() && reaction.emoji === emoji)
            );
        } else {
            // Удаляем все предыдущие реакции этого пользователя (только одна реакция на сообщение)
            message.reactions = message.reactions.filter(
                reaction => reaction.userId.toString() !== userId.toString()
            );
            
            // Добавляем новую реакцию
            message.reactions.push({
                emoji,
                userId,
                createdAt: new Date()
            });
        }

        await message.save();

        // Отправляем обновленное сообщение через WebSocket
        const receiverSocketId = userSocketMap[message.receiverId.toString()];
        const senderSocketId = userSocketMap[message.senderId.toString()];
        
        if(receiverSocketId) {
            io.to(receiverSocketId).emit("messageUpdated", message);
        }
        if(senderSocketId) {
            io.to(senderSocketId).emit("messageUpdated", message);
        }

        res.json({success: true, message: "Reaction added successfully", updatedMessage: message});
    } catch (error) {
        console.log(error);
        res.json({success: false, message: error.message});
    }
}

// Сохранить позицию скролла для чата с конкретным пользователем
export const saveScrollPosition = async (req, res) => {
    try {
        let userId, position;
        
        console.log(`💾 [saveScrollPosition] Получен запрос на сохранение позиции скролла`);
        console.log(`💾 [saveScrollPosition] Content-Type: ${req.headers['content-type']}`);
        console.log(`💾 [saveScrollPosition] Body:`, req.body);
        
        // Проверяем Content-Type для поддержки sendBeacon
        if (req.headers['content-type'] === 'text/plain') {
            // sendBeacon отправляет данные как строку
            const data = JSON.parse(req.body);
            userId = data.userId;
            position = data.position;
            console.log(`💾 [saveScrollPosition] Данные из sendBeacon: userId=${userId}, position=${position}`);
        } else {
            // Обычный JSON запрос
            userId = req.body.userId;
            position = req.body.position;
            console.log(`💾 [saveScrollPosition] Данные из JSON: userId=${userId}, position=${position}`);
        }
        
        const myId = req.user._id;
        console.log(`💾 [saveScrollPosition] Сохраняем позицию ${position} для чата с пользователем ${userId} (пользователь ${myId})`);

        // Обновляем позицию скролла в базе данных
        await User.findByIdAndUpdate(myId, {
            $set: {
                [`scrollPositions.${userId}`]: position
            }
        });

        console.log(`✅ [saveScrollPosition] Позиция скролла успешно сохранена в БД`);

        res.json({success: true, message: "Scroll position saved successfully"});
    } catch (error) {
        console.log(`❌ [saveScrollPosition] Ошибка:`, error);
        res.json({success: false, message: error.message});
    }
}