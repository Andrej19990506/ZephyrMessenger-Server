import mongoose from 'mongoose'

//connect to database
export const connectDB = async () => {
    try {
        // Устанавливаем слушатели ДО подключения
        mongoose.connection.on("connected",()=>console.log("Connected to database"))
        console.log("Connecting to database...")
        await mongoose.connect(`${process.env.MONGODB_URI}/chat-app`)
    } catch (error) {
        console.log("Database connection failed:", error)
    }
}