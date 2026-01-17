"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args) {
    const [channel, listener] = args;
    return electron.ipcRenderer.on(channel, (event, ...args2) => listener(event, ...args2));
  },
  off(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.off(channel, ...omit);
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
  // AI
  fetchModels: (config) => electron.ipcRenderer.invoke("ai:fetch-models", config),
  startChat: (message, modelConfig) => electron.ipcRenderer.send("ai:start-chat", message, modelConfig),
  cancelChat: () => electron.ipcRenderer.send("ai:cancel"),
  confirmTool: (callId, confirmed) => electron.ipcRenderer.send("ai:confirm-tool", callId, confirmed),
  // Skills
  listSkills: () => electron.ipcRenderer.invoke("skills:list")
});
