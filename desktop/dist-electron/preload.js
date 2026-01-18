"use strict";
const electron = require("electron");
const listeners = {};
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on(channel, listener) {
    const wrapper = (_event, ...args) => listener(_event, ...args);
    if (!listeners[channel]) listeners[channel] = [];
    listener._wrapper = wrapper;
    listeners[channel].push(listener);
    electron.ipcRenderer.on(channel, wrapper);
  },
  off(channel, listener) {
    const wrapper = listener._wrapper;
    if (wrapper) {
      electron.ipcRenderer.off(channel, wrapper);
    }
    if (listeners[channel]) {
      listeners[channel] = listeners[channel].filter((l) => l !== listener);
    }
  },
  removeAllListeners(channel) {
    electron.ipcRenderer.removeAllListeners(channel);
    delete listeners[channel];
  },
  send(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.send(channel, ...omit);
  },
  invoke(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.invoke(channel, ...omit);
  },
  // Database / Settings
  saveSettings: (settings) => electron.ipcRenderer.invoke("db:save-settings", settings),
  getSettings: () => electron.ipcRenderer.invoke("db:get-settings"),
  // AI (Legacy)
  fetchModels: (config) => electron.ipcRenderer.invoke("ai:fetch-models", config),
  startChat: (message, modelConfig) => electron.ipcRenderer.send("ai:start-chat", message, modelConfig),
  cancelChat: () => electron.ipcRenderer.send("ai:cancel"),
  confirmTool: (callId, confirmed) => electron.ipcRenderer.send("ai:confirm-tool", callId, confirmed),
  // New Chat Service (Gemini CLI features)
  chat: {
    send: (data) => electron.ipcRenderer.send("chat:send-message", data),
    cancel: () => electron.ipcRenderer.send("chat:cancel"),
    confirmTool: (callId, confirmed) => electron.ipcRenderer.send("chat:confirm-tool", { callId, confirmed }),
    getSessions: () => electron.ipcRenderer.invoke("chat:get-sessions"),
    createSession: (title) => electron.ipcRenderer.invoke("chat:create-session", title),
    deleteSession: (sessionId) => electron.ipcRenderer.invoke("chat:delete-session", sessionId),
    getMessages: (sessionId) => electron.ipcRenderer.invoke("chat:get-messages", sessionId),
    clearMessages: (sessionId) => electron.ipcRenderer.invoke("chat:clear-messages", sessionId)
  },
  // Skills
  listSkills: () => electron.ipcRenderer.invoke("skills:list"),
  // Embedding Index
  getIndexStatus: (advisorId) => electron.ipcRenderer.invoke("advisors:get-index-status", { advisorId }),
  syncEmbeddings: (advisorId) => electron.ipcRenderer.invoke("advisors:sync-embeddings", { advisorId })
});
