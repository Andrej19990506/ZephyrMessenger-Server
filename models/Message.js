import mongoose from 'mongoose'

const messageSchema = new mongoose.Schema({
    // Текст сообщения (может быть зашифрован или обычным текстом)
    text: {
        type: mongoose.Schema.Types.Mixed, // Может быть строкой или объектом с зашифрованными данными
        default: null
    },
    // Флаг, указывающий зашифровано ли сообщение (E2EE)
    encrypted: {
        type: Boolean,
        default: false
    },
    // E2EE: Зашифрованный blob (XChaCha20-Poly1305)
    encryptedBlob: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    image: {type: String},
    // 🎤 Голосовое сообщение (URL зашифрованного файла)
    audio: {
        type: String,
        default: null
    },
    // 🎤 Длительность голосового в миллисекундах
    audioDuration: {
        type: Number,
        default: null
    },
    // 🔐 Message Key для Double Ratchet (зашифрованный ключ для расшифровки аудио)
    messageKey: {
        type: String,
        default: null
    },
    senderId: {type: mongoose.Schema.Types.ObjectId, ref: "User", required: true},
    receiverId: {type: mongoose.Schema.Types.ObjectId, ref: "User", required: true},
    seen: {type: Boolean, default: false},
    reactions: [{
        emoji: {type: String, required: true},
        userId: {type: mongoose.Schema.Types.ObjectId, ref: "User", required: true},
        createdAt: {type: Date, default: Date.now}
    }]
}, {timestamps: true});

// E2EE: Виртуальное поле для получения расшифрованного текста (расшифровка на клиенте)
messageSchema.virtual('decryptedText').get(function() {
    if (this.encrypted && typeof this.text === 'object') {
        // E2EE: Расшифровка происходит на клиенте
        return this.text;
    }
    return this.text;
});

// E2EE: Метод для установки зашифрованного текста
messageSchema.methods.setEncryptedText = function(encryptedData) {
    this.text = encryptedData;
    this.encrypted = true;
    return this;
};

// E2EE: Метод для получения расшифрованного текста (расшифровка на клиенте)
messageSchema.methods.getDecryptedText = function(decryptFunction) {
    if (this.encrypted && typeof this.text === 'object') {
        return decryptFunction(this.text);
    }
    return this.text;
};

const Message = mongoose.model("Message", messageSchema)

export default Message