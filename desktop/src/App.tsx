import { useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { Chat } from './pages/Chat';
import { CreativeChat } from './pages/CreativeChat';
import { Skills } from './pages/Skills';
import { Knowledge } from './pages/Knowledge';
import { Advisors } from './pages/Advisors';
import { Settings } from './pages/Settings';
import { Manuscripts } from './pages/Manuscripts';
import { Archives } from './pages/Archives';
import { Wander } from './pages/Wander';
import { XhsBrowser } from './pages/XhsBrowser';
import { RedClaw } from './pages/RedClaw';
import { MediaLibrary } from './pages/MediaLibrary';
import { ImageGen } from './pages/ImageGen';

export type ViewType = 'chat' | 'creative-chat' | 'skills' | 'knowledge' | 'advisors' | 'settings' | 'manuscripts' | 'archives' | 'wander' | 'xhs-browser' | 'redclaw' | 'media-library' | 'image-gen';

// 待发送的聊天消息（用于跨页面传递）
export interface PendingChatMessage {
  content: string;          // 实际发送给 AI 的完整内容
  displayContent?: string;  // UI 上显示的简短内容
  attachment?: {
    type: 'youtube-video';
    title: string;
    thumbnailUrl?: string;
    videoId?: string;
  };
}

function App() {
  const [currentView, setCurrentView] = useState<ViewType>('manuscripts');
  const [pendingChatMessage, setPendingChatMessage] = useState<PendingChatMessage | null>(null);
  const [pendingManuscriptFile, setPendingManuscriptFile] = useState<string | null>(null);
  const [xhsBrowserInitialized, setXhsBrowserInitialized] = useState(false);

  useEffect(() => {
    if (currentView === 'xhs-browser') {
      setXhsBrowserInitialized(true);
    }
  }, [currentView]);

  // 导航到 Chat 页面并发送消息
  const navigateToChat = (message: PendingChatMessage) => {
    setPendingChatMessage(message);
    setCurrentView('chat');
  };

  // Chat 页面消费消息后清除
  const clearPendingMessage = () => {
    setPendingChatMessage(null);
  };

  // 导航到稿件页面并打开指定文件
  const navigateToManuscript = (filePath: string) => {
    setPendingManuscriptFile(filePath);
    setCurrentView('manuscripts');
  };

  // 稿件页面消费后清除
  const clearPendingManuscriptFile = () => {
    setPendingManuscriptFile(null);
  };

  return (
    <>
      <Layout currentView={currentView} onNavigate={setCurrentView}>
        {currentView === 'chat' && (
          <Chat
            pendingMessage={pendingChatMessage}
            onMessageConsumed={clearPendingMessage}
          />
        )}
        {currentView === 'creative-chat' && <CreativeChat />}
        {currentView === 'skills' && <Skills />}
        {currentView === 'knowledge' && <Knowledge onNavigateToChat={navigateToChat} />}
        {currentView === 'advisors' && <Advisors />}
        {currentView === 'settings' && <Settings />}
        {currentView === 'manuscripts' && (
          <Manuscripts
            pendingFile={pendingManuscriptFile}
            onFileConsumed={clearPendingManuscriptFile}
          />
        )}
        {currentView === 'archives' && <Archives />}
        {currentView === 'wander' && <Wander onNavigateToManuscript={navigateToManuscript} />}
        {currentView === 'redclaw' && <RedClaw />}
        {currentView === 'media-library' && <MediaLibrary />}
        {currentView === 'image-gen' && <ImageGen />}
        {xhsBrowserInitialized && (
          <div className={currentView === 'xhs-browser' ? 'h-full min-h-0 flex flex-col' : 'hidden'}>
            <XhsBrowser />
          </div>
        )}
      </Layout>
    </>
  );
}

export default App;
