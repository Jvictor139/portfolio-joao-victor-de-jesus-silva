import React, { useState, useEffect, useRef, useCallback } from 'react';
import { marked } from 'marked';
import Prism from 'prismjs';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-json';
import { 
  Bold, 
  Italic, 
  List, 
  ListOrdered, 
  Link as LinkIcon, 
  Image as ImageIcon, 
  Eye, 
  EyeOff, 
  Columns,
  Code,
  Quote,
  Heading1,
  Heading2,
  Github,
  Download,
  Trash2,
  Palette,
  LogIn,
  LogOut,
  Share2,
  Check,
  ChevronDown,
  Layout
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db, signInWithGoogle } from './lib/firebase';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, getDocFromServer, Timestamp } from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Configure marked
marked.setOptions({
  breaks: true,
  gfm: true,
});

const DEFAULT_MARKDOWN = `# DarkEditor 🌒

Bem-vindo ao seu novo espaço de escrita minimalista.

## Novas Funcionalidades:
- **Cloud Sync**: Faça login para salvar seus textos e preferências.
- **Paletas Dinâmicas**: Mude o visual do app no menu de paletas.
- **Drag & Drop**: Arraste arquivos .txt ou .md diretamente para o editor.
- **Compartilhamento**: Gere links rápidos ou copie o código do seu texto.
- **Auto-correção**: Corretor gramatical nativo habilitado.

Experimente agora!
`;

type PaletteType = 'default-dark' | 'midnight' | 'forest' | 'crimson' | 'light';

export default function App() {
  const [markdown, setMarkdown] = useState(DEFAULT_MARKDOWN);
  const [html, setHtml] = useState('');
  const [viewMode, setViewMode] = useState<'split' | 'editor' | 'preview'>('split');
  const [isSyncScroll, setIsSyncScroll] = useState(true);
  const [palette, setPalette] = useState<PaletteType>('default-dark');
  const [user, setUser] = useState<User | null>(null);
  const [isPaletteMenuOpen, setIsPaletteMenuOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isScrolling = useRef<boolean>(false);

  // Auth Listener
  useEffect(() => {
    // Validate connection to Firestore as per skill mandate
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        loadUserPrefs(u.uid);
        subscribeToDoc(u.uid);
      }
    });
    return () => unsubscribe();
  }, []);

  const loadUserPrefs = async (uid: string) => {
    const path = `users/${uid}`;
    try {
      const prefDoc = await getDoc(doc(db, 'users', uid));
      if (prefDoc.exists()) {
        const data = prefDoc.data();
        if (data.palette) setPalette(data.palette as PaletteType);
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, path);
    }
  };

  const subscribeToDoc = (uid: string) => {
    const path = `documents/${uid}`;
    return onSnapshot(doc(db, 'documents', uid), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.content && document.activeElement !== editorRef.current) {
          setMarkdown(data.content);
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });
  };

  // Auto-Save
  useEffect(() => {
    if (user && markdown !== DEFAULT_MARKDOWN) {
      const timeout = setTimeout(async () => {
        const path = `documents/${user.uid}`;
        try {
          await setDoc(doc(db, 'documents', user.uid), { 
            content: markdown, 
            updatedAt: Timestamp.now() 
          }, { merge: true });
        } catch (e) {
          handleFirestoreError(e, OperationType.WRITE, path);
        }
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [markdown, user]);

  // Sync Palette
  useEffect(() => {
    document.documentElement.setAttribute('data-palette', palette);
    if (user) {
      const path = `users/${user.uid}`;
      const updatePalette = async () => {
        try {
          await setDoc(doc(db, 'users', user.uid), { palette }, { merge: true });
        } catch (e) {
          handleFirestoreError(e, OperationType.WRITE, path);
        }
      };
      updatePalette();
    }
  }, [palette, user]);

  // Render Markdown
  useEffect(() => {
    const renderMarkdown = async () => {
      const parsed = await marked.parse(markdown);
      setHtml(parsed);
    };
    renderMarkdown();
  }, [markdown]);

  useEffect(() => {
    if (html) {
      Prism.highlightAll();
    }
  }, [html]);

  // Editor Highlight Rendering
  const highlightMarkdown = (text: string) => {
    let highlighted = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    highlighted = highlighted.replace(/^(#{1,6}.*)$/gm, '<span class="token header">$1</span>');
    highlighted = highlighted.replace(/(\*\*|__)(.*?)\1/g, '<span class="token bold">$1$2$1</span>');
    highlighted = highlighted.replace(/(\*|_)(.*?)\1/g, '<span class="token italic">$1$2$1</span>');
    highlighted = highlighted.replace(/^(\s*[-*+]\s+.*)$/gm, '<span class="token list">$1</span>');
    highlighted = highlighted.replace(/^(\s*\d+\.\s+.*)$/gm, '<span class="token list">$1</span>');
    highlighted = highlighted.replace(/\[(.*?)\]\((.*?)\)/g, '<span class="token link">[$1]($2)</span>');
    highlighted = highlighted.replace(/`([^`]+)`/g, '<span class="token code">`$1`</span>');
    highlighted = highlighted.replace(/^(\s*>.*)$/gm, '<span class="token blockquote">$1</span>');

    return highlighted + '\n';
  };

  // Sync Scroll Implementation
  const handleScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    if (!isSyncScroll || isScrolling.current) return;

    const source = e.currentTarget;
    const target = source === editorRef.current ? previewRef.current : editorRef.current;

    if (target) {
      isScrolling.current = true;
      const percentage = source.scrollTop / (source.scrollHeight - source.clientHeight);
      target.scrollTop = percentage * (target.scrollHeight - target.clientHeight);
      
      if (source === editorRef.current && highlightRef.current) {
        highlightRef.current.scrollTop = source.scrollTop;
      }

      setTimeout(() => {
        isScrolling.current = false;
      }, 50);
    }
  }, [isSyncScroll]);

  const insertText = (before: string, after: string = '') => {
    const textarea = editorRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selectedText = text.substring(start, end);
    const newText = text.substring(0, start) + before + selectedText + after + text.substring(end);

    setMarkdown(newText);
    
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, end + before.length);
    }, 0);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result;
      if (typeof base64 === 'string') {
        insertText(`![${file.name}](`, `${base64})`);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const items = Array.from(e.dataTransfer.items);
    
    for (const item of items as DataTransferItem[]) {
       if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file && (file.name.endsWith('.txt') || file.name.endsWith('.md'))) {
             const text = await file.text();
             setMarkdown(text);
          } else if (file && file.type.startsWith('image/')) {
             const reader = new FileReader();
             reader.onload = (event) => {
                const base64 = event.target?.result;
                if (typeof base64 === 'string') {
                   insertText(`![${file.name}](`, `${base64})`);
                }
             };
             reader.readAsDataURL(file);
          }
       } else if (item.kind === 'string' && item.type === 'text/plain') {
          item.getAsString((s) => insertText(s));
       }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const [shareUrl, setShareUrl] = useState<string | null>(null);

  // Check for shared content on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareId = params.get('s');
    if (shareId) {
      loadSharedDoc(shareId);
    }
  }, []);

  const loadSharedDoc = async (id: string) => {
    try {
      const shareDoc = await getDoc(doc(db, 'shares', id));
      if (shareDoc.exists()) {
        const data = shareDoc.data();
        if (data.content) {
          setMarkdown(data.content);
          setViewMode('preview'); // Open in preview for shared content
        }
      }
    } catch (e) {
      console.error("Error loading shared doc", e);
    }
  };

  const handleShare = async () => {
    try {
      const shareId = Math.random().toString(36).substring(2, 15);
      await setDoc(doc(db, 'shares', shareId), {
        content: markdown,
        createdAt: Timestamp.now(),
        author: user?.uid || 'anonymous'
      });
      
      const url = `${window.location.origin}${window.location.pathname}?s=${shareId}`;
      await navigator.clipboard.writeText(url);
      setShareUrl(url);
      setCopyFeedback(true);
      setTimeout(() => {
        setCopyFeedback(false);
        setShareUrl(null);
      }, 3000);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'shares');
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[var(--bg-app)] text-[var(--text-main)] transition-colors duration-500 selection:bg-[var(--accent)] selection:text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-4 border-b border-[var(--border-color)] bg-[var(--bg-toolbar)] z-50">
        <div className="flex items-center space-x-8">
          <div className="flex items-center space-x-3 group">
            <div className="p-2 bg-[var(--accent)] rounded-xl shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform">
              <Code className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight">DarkEditor</span>
          </div>

          <nav className="hidden lg:flex items-center space-x-1">
             <ToolbarButton onClick={() => insertText('**', '**')} icon={<Bold className="w-4 h-4" />} />
             <ToolbarButton onClick={() => insertText('_', '_')} icon={<Italic className="w-4 h-4" />} />
             <div className="w-px h-4 bg-[var(--border-color)] mx-2" />
             <ToolbarButton onClick={() => insertText('# ')} icon={<Heading1 className="w-4 h-4" />} />
             <ToolbarButton onClick={() => insertText('## ')} icon={<Heading2 className="w-4 h-4" />} />
             <div className="w-px h-4 bg-[var(--border-color)] mx-2" />
             <ToolbarButton onClick={() => insertText('- ')} icon={<List className="w-4 h-4" />} />
             <ToolbarButton onClick={() => insertText('> ')} icon={<Quote className="w-4 h-4" />} />
             <ToolbarButton onClick={() => insertText('```\n', '\n```')} icon={<Code className="w-4 h-4" />} />
             <ToolbarButton onClick={() => fileInputRef.current?.click()} icon={<ImageIcon className="w-4 h-4" />} />
             <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
          </nav>
        </div>

        <div className="flex items-center space-x-4">
           {/* Palette */}
           <div className="relative">
              <button 
                onClick={() => setIsPaletteMenuOpen(!isPaletteMenuOpen)}
                className="p-2 rounded-xl border border-[var(--border-color)] hover:bg-[var(--border-color)] transition-all"
              >
                <Palette className="w-5 h-5" />
              </button>
              <AnimatePresence>
                {isPaletteMenuOpen && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="absolute right-0 mt-3 w-56 bg-[var(--bg-toolbar)] border border-[var(--border-color)] rounded-2xl shadow-2xl p-2 z-[100]"
                  >
                    <PaletteOption current={palette} value="light" label="Light Modern" color="bg-white border-zinc-200" onClick={(v) => {setPalette(v); setIsPaletteMenuOpen(false); }} />
                    <PaletteOption current={palette} value="default-dark" label="Default Dark" color="bg-zinc-900 border-zinc-700" onClick={(v) => {setPalette(v); setIsPaletteMenuOpen(false); }} />
                    <PaletteOption current={palette} value="midnight" label="Midnight Blue" color="bg-slate-950 border-slate-800" onClick={(v) => {setPalette(v); setIsPaletteMenuOpen(false); }} />
                    <PaletteOption current={palette} value="forest" label="Deep Forest" color="bg-green-950 border-green-900" onClick={(v) => {setPalette(v); setIsPaletteMenuOpen(false); }} />
                    <PaletteOption current={palette} value="crimson" label="Crimson Red" color="bg-red-950 border-red-900" onClick={(v) => {setPalette(v); setIsPaletteMenuOpen(false); }} />
                  </motion.div>
                )}
              </AnimatePresence>
           </div>

           <ToolbarButton onClick={handleShare} icon={copyFeedback ? <Check className="w-5 h-5 text-green-500" /> : <Share2 className="w-5 h-5" />} />

           <div className="flex bg-[var(--border-color)] rounded-xl p-1 gap-1">
             <ViewModeToggle active={viewMode === 'editor'} onClick={() => setViewMode('editor')} icon={<EyeOff className="w-4 h-4" />} />
             <ViewModeToggle active={viewMode === 'split'} onClick={() => setViewMode('split')} icon={<Columns className="w-4 h-4" />} />
             <ViewModeToggle active={viewMode === 'preview'} onClick={() => setViewMode('preview')} icon={<Eye className="w-4 h-4" />} />
           </div>

           {user ? (
             <div className="flex items-center space-x-3 pl-2">
               <img src={user.photoURL || ''} alt="" className="w-9 h-9 rounded-full border-2 border-[var(--accent)] p-0.5" />
               <button onClick={() => signOut(auth)} className="hover:text-red-500 transition-colors"><LogOut className="w-5 h-5 text-[var(--text-muted)]" /></button>
             </div>
           ) : (
             <button 
               onClick={signInWithGoogle}
               className="flex items-center space-x-2 px-5 py-2 bg-[var(--accent)] text-white rounded-xl font-bold text-sm hover:scale-105 active:scale-95 transition-all shadow-xl shadow-blue-500/30"
             >
               <LogIn className="w-4 h-4" />
               <span>Login</span>
             </button>
           )}
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 flex overflow-hidden relative">
        <AnimatePresence mode="wait">
           {(viewMode === 'split' || viewMode === 'editor') && (
             <motion.div 
               key="editor-panel"
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               className={`h-full border-r border-[var(--border-color)] bg-[var(--bg-editor)] transition-all ${viewMode === 'split' ? 'w-1/2' : 'w-full'}`}
               onDrop={handleDrop}
               onDragOver={handleDragOver}
             >
                <div className="editor-container h-full group">
                  <div 
                    ref={highlightRef}
                    className="editor-highlight overflow-y-auto scrollbar-hide"
                    dangerouslySetInnerHTML={{ __html: highlightMarkdown(markdown) }}
                  />
                  <textarea
                    ref={editorRef}
                    value={markdown}
                    onChange={(e) => setMarkdown(e.target.value)}
                    onScroll={handleScroll}
                    className="editor-textarea selection:bg-[var(--accent)]/30"
                    spellCheck="true"
                    placeholder="Arraste arquivos aqui..."
                  />
                </div>
             </motion.div>
           )}

           {(viewMode === 'split' || viewMode === 'preview') && (
             <motion.div 
               key="preview-panel"
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               ref={previewRef}
               onScroll={handleScroll}
               className={`h-full overflow-y-auto bg-[var(--bg-preview)] p-12 lg:p-24 scroll-smooth ${viewMode === 'split' ? 'w-1/2' : 'w-full'}`}
             >
               <article className="prose prose-zinc prose-invert max-w-2xl mx-auto selection:bg-[var(--accent)]/40">
                  <div dangerouslySetInnerHTML={{ __html: html }} />
               </article>
             </motion.div>
           )}
        </AnimatePresence>

        {/* Sync Scroll Toggle */}
        <div className="absolute bottom-8 right-8 flex items-center space-x-4 bg-[var(--bg-toolbar)] border border-[var(--border-color)] shadow-[0_0_50px_rgba(0,0,0,0.3)] rounded-2xl px-6 py-3 z-50">
           <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">Live Scroll</span>
           <button 
             onClick={() => setIsSyncScroll(!isSyncScroll)}
             className={`w-10 h-6 rounded-full transition-all relative ${isSyncScroll ? 'bg-green-500' : 'bg-zinc-800'}`}
           >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-lg transition-all ${isSyncScroll ? 'left-5' : 'left-1'}`} />
           </button>
        </div>
      </main>

      {/* Footer */}
      <footer className="px-8 py-3 border-t border-[var(--border-color)] bg-[var(--bg-toolbar)] flex justify-between items-center text-[10px] uppercase font-bold tracking-widest text-[var(--text-muted)]">
        <div className="flex items-center space-x-8">
           <span className="flex items-center"><div className="w-1 h-1 bg-[var(--accent)] mr-2 rounded-full" /> {markdown.length} Characters</span>
           <span className="flex items-center"><div className="w-1 h-1 bg-[var(--accent)] mr-2 rounded-full" /> {markdown.trim() ? markdown.trim().split(/\s+/).length : 0} Words</span>
        </div>
        
        <div className="flex items-center space-x-6">
           <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${user ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-zinc-700'}`} />
              <span>{user ? `Synced as ${user.displayName}` : 'Guest Mode'}</span>
           </div>
           <span className="opacity-30">© 2026 DarkEditor</span>
        </div>
      </footer>
    </div>
  );
}

function ToolbarButton({ onClick, icon }: { onClick: () => void, icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="p-2.5 text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--border-color)] rounded-xl transition-all active:scale-95"
    >
      {icon}
    </button>
  );
}

function ViewModeToggle({ active, onClick, icon }: { active: boolean, onClick: () => void, icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`p-2 rounded-lg transition-all ${
        active 
          ? 'bg-[var(--bg-app)] text-[var(--accent)] shadow-md' 
          : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
      }`}
    >
      {icon}
    </button>
  );
}

function PaletteOption({ current, value, label, color, onClick }: { current: string, value: PaletteType, label: string, color: string, onClick: (v: PaletteType) => void }) {
  return (
    <button 
      onClick={() => onClick(value)}
      className={`w-full flex items-center space-x-4 px-4 py-3 rounded-xl hover:bg-[var(--border-color)] transition-all ${current === value ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : ''}`}
    >
      <div className={`w-5 h-5 rounded-lg border-2 ${color}`} />
      <span className="text-sm font-semibold">{label}</span>
      {current === value && <Check className="w-4 h-4 ml-auto" />}
    </button>
  );
}
