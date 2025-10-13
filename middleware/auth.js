import jwt from "jsonwebtoken";
import User from "../models/User.js";

//middleware to check if user is authenticated
export const protectRoute = async (req, res, next) => {
    try {
        // Проверяем заголовок Authorization
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.json({success: false, message: "jwt must be provided"});
        }
        
        // Извлекаем токен из заголовка
        const token = authHeader.substring(7); // Убираем "Bearer "
        
        console.log(`🔐 [protectRoute] Проверка токена для запроса: ${req.method} ${req.path}`);

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = await User.findById(decoded.userId).select("-password");

        if(!user) {
            console.log(`❌ [protectRoute] Пользователь не найден: ${decoded.userId}`);
            return res.json({success: false, message: "User not found"});
        }

        console.log(`✅ [protectRoute] Аутентификация успешна для пользователя: ${user.name}`);
        req.user = user;
        next();
    } catch (error) {
        console.log(`❌ [protectRoute] Ошибка аутентификации:`, error.message);
        res.json({success: false, message: error.message});
    }
}