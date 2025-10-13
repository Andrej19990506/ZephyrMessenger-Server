import mongoose from 'mongoose'

const userSchema = new mongoose.Schema({
    email: {type: String, required: true, unique: true},
    name: {type: String, required: true},
    username: {type: String, default: null}, // username необязательный и не уникальный
    password: {type: String, required: true, minlength: 6},
    profilePic: {type: String, default: ""},
    bio: {type: String},
    lastSeen: {type: Date, default: Date.now},
    scrollPositions: {type: Map, of: Number, default: new Map()}, // userId -> scrollPosition
    fcmToken: {type: String, default: null}, // Firebase Cloud Messaging токен для push-уведомлений
    
    // 📱 Phone Auth поля
    phoneNumber: {type: String, default: null, unique: true, sparse: true}, // Номер телефона (уникальный если есть)
    firebaseUid: {type: String, default: null, unique: true, sparse: true}, // Firebase UID (уникальный если есть)
    isVerified: {type: Boolean, default: false}, // Верифицирован ли пользователь
    
    // E2EE Prekey Bundle (Signal Protocol)
    identityKey: {type: String, default: null}, // X25519 публичный ключ для ECDH
    identitySigningKey: {type: String, default: null}, // Ed25519 публичный ключ для подписей
    signedPreKey: {
        keyId: {type: Number, default: 0},
        publicKey: {type: String, default: null},
        signature: {type: String, default: null},
        timestamp: {type: Date, default: Date.now}
    },
    oneTimePreKeys: [{
        keyId: {type: Number, required: true},
        publicKey: {type: String, required: true}
    }],
    
    // Для обратной совместимости (deprecated)
    publicKey: {type: String, default: null}
}, {timestamps: true});

const User = mongoose.model("User", userSchema)

export default User