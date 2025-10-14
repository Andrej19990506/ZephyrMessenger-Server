import express from "express";
import { protectRoute } from "../middleware/auth.js";
import { getUsersForSidebar, getMessages, markMessageAsSeen, sendMessage, deleteMessage, addReaction, saveScrollPosition, uploadSingle, markMessagesAsSeen, deleteChatWithUser, uploadAudio, uploadAudioFile } from "../controllers/messageController.js";

export const messageRouter = express.Router();

messageRouter.get("/users", protectRoute, getUsersForSidebar);
messageRouter.get("/:id", protectRoute, getMessages);
messageRouter.put("/mark/:id", protectRoute, markMessageAsSeen);
messageRouter.put("/mark-messages/:userId", protectRoute, markMessagesAsSeen);
messageRouter.delete("/chat/:userId", protectRoute, deleteChatWithUser);
messageRouter.post("/send/:id", protectRoute, uploadSingle, sendMessage);
messageRouter.delete("/:id", protectRoute, deleteMessage);
messageRouter.post("/reaction/:messageId", protectRoute, addReaction);
messageRouter.post("/save-scroll-position", protectRoute, saveScrollPosition);
// 🎤 Загрузка зашифрованного аудио файла
messageRouter.post("/upload-audio", protectRoute, uploadAudio, uploadAudioFile);

export default messageRouter;