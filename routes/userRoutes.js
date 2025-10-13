import express from "express";
import { signup, login, updateUserProfile, checkAuth, deleteUserAccount, uploadProfilePic, searchUsersByUsername, getUserById, checkPhoneNumbers, phoneAuth, checkPhoneAvailability } from "../controllers/userController.js";
import { registerFCMToken } from "../controllers/fcmController.js";
import { protectRoute } from "../middleware/auth.js";


export const userRouter = express.Router();
 userRouter.post("/signup", signup);
 userRouter.post("/login", login);
 userRouter.post("/phone-auth", phoneAuth);
 userRouter.post("/check-phone", checkPhoneAvailability);
 userRouter.put("/update-profile", protectRoute, uploadProfilePic, updateUserProfile);
 userRouter.post("/register-fcm-token", protectRoute, registerFCMToken);
 userRouter.get("/checkauth", protectRoute, checkAuth);
 userRouter.get("/search", protectRoute, searchUsersByUsername);
 userRouter.post("/check-phones", protectRoute, checkPhoneNumbers);
 userRouter.get("/:userId", protectRoute, getUserById);
 userRouter.delete("/delete", protectRoute, deleteUserAccount);

 export default userRouter;