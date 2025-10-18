import express from 'express'
import "dotenv/config"
import cors from 'cors'
import http from 'http'
import { connectDB } from './lib/db.js'
import userRouter from './routes/userRoutes.js'
import messageRouter from './routes/messageRoutes.js'
import e2eeRouter from './routes/e2eeRoutes.js'
import fcmRouter from './routes/fcmRoutes.js'
import { Server } from 'socket.io'
import User from './models/User.js'
import jwt from 'jsonwebtoken'
import messageBroker from './lib/messageBroker.js'

//create express app
const app = express()
const server = http.createServer(app)

// CORS origins - временно разрешаем все домены для продакшна
const allowedOrigins = process.env.NODE_ENV === 'production' 
    ? true // Разрешить все домены в продакшне
    : [
        process.env.FRONTEND_URL || "http://localhost:5173",
        "https://gameforlesson.vercel.app",
        "http://localhost:5173",
        /^https:\/\/.*\.vercel\.app$/, // Любые поддомены Vercel
        /^https:\/\/.*\.vercel\.dev$/  // Vercel preview URLs
    ];

console.log('🌐 [CORS] Режим:', process.env.NODE_ENV);
console.log('🌐 [CORS] Разрешенные домены:', allowedOrigins);

//initialize socket.io
export const io = new Server(server,{
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    }
})

//store online users
export const userSocketMap = {}; // {userId: socketId}

// WebSocket authentication middleware
io.use(async (socket, next) => {
    try {
        console.log("🔐 [WebSocket] Попытка аутентификации:", socket.handshake.auth);
        
        const token = socket.handshake.auth.token;
        
        if (!token) {
            console.log("❌ [WebSocket] Токен не предоставлен");
            return next(new Error('Authentication token required'));
        }

        // Проверяем JWT токен
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log("🔍 [WebSocket] Токен расшифрован:", decoded);

        // Проверяем существование пользователя
        const user = await User.findById(decoded.userId).select("-password");
        
        if (!user) {
            console.log("❌ [WebSocket] Пользователь не найден:", decoded.userId);
            return next(new Error('User not found'));
        }

        // Сохраняем информацию о пользователе в socket
        socket.userId = user._id.toString();
        socket.user = user;
        
        console.log("✅ [WebSocket] Аутентификация успешна для пользователя:", user.name);
        next();
        
    } catch (error) {
        console.log("❌ [WebSocket] Ошибка аутентификации:", error.message);
        next(new Error('Authentication failed'));
    }
});

//handle socket connection
io.on("connection",(socket)=>{
    const userId = socket.userId; // Теперь используем аутентифицированный userId
    console.log("✅ [WebSocket] Пользователь подключен:", socket.user.name, "ID:", userId)

    if(userId){ 
        userSocketMap[userId] = socket.id 
        // ✅ НЕ обновляем lastSeen при подключении - пользователь теперь ОНЛАЙН!
        // lastSeen обновляется только при отключении
        console.log("✅ [WebSocket] Пользователь добавлен в онлайн список:", userId)
        
        // 🔥 НОВОЕ: Отправляем всем клиентам событие о подключении
        io.emit("userStatusChanged", {
            userId: userId,
            lastSeen: null, // null означает "онлайн прямо сейчас"
            isOnline: true
        });
        
        console.log("📡 [WebSocket] Отправлено событие userStatusChanged (online):", userId);
    }

    //Emit online users to all connected clients
    io.emit("getOnlineUsers", Object.keys(userSocketMap))

    socket.on("disconnect",()=>{
        console.log("🔌 [WebSocket] Пользователь отключился:", userId)
        delete userSocketMap[userId]
        
        const now = new Date();
        
        // ✅ Обновляем lastSeen ТОЛЬКО при отключении
        User.findByIdAndUpdate(userId, {lastSeen: now})
            .then(()=>{
                console.log("⏰ [WebSocket] lastSeen обновлен для пользователя:", userId, "время:", now.toISOString())
                
                // 🔥 НОВОЕ: Отправляем всем клиентам событие об изменении статуса
                io.emit("userStatusChanged", {
                    userId: userId,
                    lastSeen: now.toISOString(),
                    isOnline: false
                });
                
                console.log("📡 [WebSocket] Отправлено событие userStatusChanged:", userId);
            })
            .catch((error)=>{
                console.log("❌ [WebSocket] Ошибка обновления lastSeen:", error.message)
            })
        
        // Отправляем обновленный список онлайн пользователей
        io.emit("getOnlineUsers", Object.keys(userSocketMap))
    })

    socket.on("typing",(data)=>{
        console.log("⌨️ [WebSocket] Пользователь печатает:", socket.user.name, "для:", data.receiverId);
        
        // Проверяем, что пользователь может отправлять typing события только для своих чатов
        const receiverSocketId = userSocketMap[data.receiverId];
        if(receiverSocketId){
            socket.to(receiverSocketId).emit("userTyping",{
                senderId: userId,
                senderName: socket.user.name,
                isTyping: data.isTyping
            });
        }
    })

    // Обработчик события прочтения сообщения
    socket.on("messageSeen",(data)=>{
        console.log("👁️ [WebSocket] Сообщение прочитано:", data.messageId, "пользователем:", socket.user.name);
        
        // Проверяем, что пользователь может отмечать сообщения как прочитанные
        const senderSocketId = userSocketMap[data.senderId];
        if(senderSocketId){
            socket.to(senderSocketId).emit("messageSeen",{
                messageId: data.messageId,
                senderId: data.senderId,
                readerId: userId,
                readerName: socket.user.name
            });
        }
    })

       // 🔥 НОВОЕ: Обработчик события "пользователь онлайн" - проверяем очередь сообщений
       socket.on("userOnline", async (data) => {
           console.log("📡 [WebSocket] Получено событие userOnline от пользователя:", socket.user.name, "ID:", userId);
           console.log("📡 [WebSocket] Данные события:", data);
           console.log("🔍 [WebSocket] Проверяем очередь для userId:", userId);
           
           try {
               // Получаем все сообщения из очереди для этого пользователя
               console.log("🔍 [WebSocket] Вызываем messageBroker.getMessagesFromQueue...");
               const queuedMessages = await messageBroker.getMessagesFromQueue(userId);
               console.log("🔍 [WebSocket] Результат getMessagesFromQueue:", queuedMessages.length, "сообщений");
               
               if (queuedMessages.length > 0) {
                   console.log(`📥 [WebSocket] Найдено ${queuedMessages.length} пропущенных сообщений для пользователя ${socket.user.name}`);
                   console.log("📥 [WebSocket] Первое сообщение:", queuedMessages[0]);
                   
                   // Отправляем все пропущенные сообщения через WebSocket
                   socket.emit('queuedMessages', {
                       messages: queuedMessages
                   });
                   console.log("📤 [WebSocket] Сообщения отправлены клиенту");
                   
                   // Удаляем сообщения из очереди после успешной отправки
                   await messageBroker.clearUserQueue(userId);
                   console.log(`✅ [WebSocket] Очередь очищена для пользователя ${socket.user.name}`);
               } else {
                   console.log(`📭 [WebSocket] Пропущенных сообщений нет для пользователя ${socket.user.name}`);
                   console.log("🔍 [WebSocket] Возможные причины: очередь пуста, сообщения уже получены, или ошибка Redis");
                   
                   // Отправляем пустой массив чтобы клиент знал что очередь проверена
                   socket.emit('queuedMessages', {
                       messages: []
                   });
                   console.log("📤 [WebSocket] Пустой массив отправлен клиенту");
               }
           } catch (error) {
               console.error("❌ [WebSocket] Ошибка при проверке очереди сообщений:", error);
               
               // Отправляем пустой массив в случае ошибки
               socket.emit('queuedMessages', {
                   messages: []
               });
           }
       });

       // 📢 НОВОЕ: Обработчик системных сообщений
       socket.on("systemMessage", async (data) => {
           console.log("📢 [WebSocket] Получено системное сообщение от пользователя:", socket.user.name, "ID:", userId);
           console.log("📢 [WebSocket] Данные системного сообщения:", data);
           
           try {
               // Импортируем модель Message
               const Message = (await import('./models/Message.js')).default;
               
               // Создаем системное сообщение в базе данных
               const systemMessage = new Message({
                   text: data.text,
                   senderId: userId,
                   receiverId: userId, // Системное сообщение для самого пользователя
                   isSystemMessage: true,
                   systemType: data.systemType,
                   seen: false,
                   status: 'delivered',
                   createdAt: new Date(data.timestamp || Date.now())
               });
               
               await systemMessage.save();
               console.log("✅ [WebSocket] Системное сообщение сохранено в БД:", systemMessage._id);
               
               // Отправляем системное сообщение всем контактам пользователя
               const contacts = await Message.aggregate([
                   {
                       $match: {
                           $or: [
                               { senderId: userId },
                               { receiverId: userId }
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
               
               if (contacts.length > 0 && contacts[0].userIds.length > 0) {
                   const contactIds = contacts[0].userIds.map(id => id.toString());
                   console.log(`📢 [WebSocket] Отправка системного сообщения ${contactIds.length} контактам`);
                   
                   // Отправляем системное сообщение всем онлайн контактам
                   contactIds.forEach(contactId => {
                       const socketId = userSocketMap[contactId];
                       if (socketId) {
                           io.to(socketId).emit('systemMessage', {
                               id: systemMessage._id.toString(),
                               text: data.text,
                               systemType: data.systemType,
                               timestamp: data.timestamp,
                               isSystemMessage: true,
                               senderId: userId,
                               senderName: socket.user.name
                           });
                       }
                   });
                   
                   console.log("✅ [WebSocket] Системное сообщение отправлено контактам");
               } else {
                   console.log("📢 [WebSocket] Нет контактов для отправки системного сообщения");
               }
               
           } catch (error) {
               console.error("❌ [WebSocket] Ошибка обработки системного сообщения:", error);
           }
       });
})


//middleware
app.use(express.json({limit:'100mb'}))
app.use(express.text({limit:'10mb'})) // Для поддержки sendBeacon
app.use(express.urlencoded({ extended: true, limit: '100mb' })) // Для FormData
app.use(cors({
    origin: allowedOrigins,
    credentials: true
}))

//routes setup
app.use("/api/status",(req,res)=> res.status(200).send("Server is running"))
app.use("/api/auth", userRouter)
app.use("/api/user", userRouter)
app.use("/api/message", messageRouter)
app.use("/api/e2ee", e2eeRouter)
app.use("/api/fcm", fcmRouter)

//connect to MongoDB
await connectDB()


    const PORT = process.env.PORT || 5000
    server.listen(PORT,()=>{
        console.log(`Server is running on port ${PORT}`)
    })

