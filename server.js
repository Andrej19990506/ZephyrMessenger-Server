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

