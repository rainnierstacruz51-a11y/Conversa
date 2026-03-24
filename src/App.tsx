/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  signInWithPopup, 
  GoogleAuthProvider,
  User as FirebaseUser,
  updateProfile
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  getDoc, 
  getDocs,
  serverTimestamp,
  increment,
  setDoc,
  Timestamp,
  DocumentData,
  deleteDoc
} from 'firebase/firestore';
import { auth, db, storage } from './firebase';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { cn } from './lib/utils';
import { 
  MessageSquare, 
  LogOut, 
  Search, 
  Plus, 
  Send, 
  ArrowLeft, 
  Settings, 
  X, 
  Check,
  User as UserIcon,
  Camera,
  Loader2,
  ChevronLeft,
  Phone,
  Video,
  Info,
  PlusCircle,
  Image,
  Smile,
  Paperclip,
  FileVideo,
  FileImage
} from 'lucide-react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
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
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

interface UserProfile {
  uid: string;
  name: string;
  email: string;
  avatar?: string;
  status: 'online' | 'offline';
  lastSeen: Timestamp;
}

interface Chat {
  id: string;
  members: string[];
  isGroup: boolean;
  name?: string;
  lastMessage?: string;
  lastUpdated?: Timestamp;
  unread?: Record<string, number>;
}

interface Message {
  id: string;
  chatId: string;
  senderId: string;
  text?: string;
  imageUrl?: string;
  videoUrl?: string;
  type: 'text' | 'image' | 'video';
  timestamp: Timestamp;
  reactions?: Record<string, string[]>;
}

interface Story {
  id: string;
  userId: string;
  imageUrl: string;
  timestamp: Timestamp;
  expiresAt: Timestamp;
}

// --- Error Handler ---
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // In a real app, we might show a toast here
}

// --- Components ---

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [userProfiles, setUserProfiles] = useState<Record<string, UserProfile>>({});
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileAvatar, setProfileAvatar] = useState('');
  const [updatingProfile, setUpdatingProfile] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [showCallModal, setShowCallModal] = useState<{ type: 'voice' | 'video', active: boolean }>({ type: 'voice', active: false });
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'starting' | 'uploading' | 'finalizing' | 'error'>('idle');
  const [uploadTask, setUploadTask] = useState<any>(null);
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [activeStory, setActiveStory] = useState<Story | null>(null);
  const [showStoryUpload, setShowStoryUpload] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const storyInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      setLoading(false);
      if (user) {
        // Update presence
        const userRef = doc(db, 'users', user.uid);
        try {
          await setDoc(userRef, {
            uid: user.uid,
            name: user.displayName || user.email?.split('@')[0] || 'User',
            email: user.email,
            status: 'online',
            lastSeen: serverTimestamp(),
            createdAt: serverTimestamp()
          }, { merge: true });
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
        }
      }
    });
    return unsubscribe;
  }, []);

  // Chats Listener
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'chats'),
      where('members', 'array-contains', user.uid),
      orderBy('lastUpdated', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const chatList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Chat));
      setChats(chatList);
      
      // Fetch user profiles for chats
      chatList.forEach(chat => {
        chat.members.forEach(memberId => {
          if (memberId !== user.uid && !userProfiles[memberId]) {
            fetchUserProfile(memberId);
          }
        });
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'chats');
    });

    return unsubscribe;
  }, [user]);

  // Stories Listener
  useEffect(() => {
    if (!user) return;

    const now = new Date();
    const q = query(
      collection(db, 'stories'),
      where('expiresAt', '>', Timestamp.fromDate(now)),
      orderBy('expiresAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const storyList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Story));
      setStories(storyList);
      
      // Fetch user profiles for stories
      storyList.forEach(story => {
        if (!userProfiles[story.userId]) {
          fetchUserProfile(story.userId);
        }
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'stories');
    });

    return unsubscribe;
  }, [user]);

  // Messages Listener
  useEffect(() => {
    if (!activeChat) {
      setMessages([]);
      return;
    }

    const q = query(
      collection(db, 'messages'),
      where('chatId', '==', activeChat.id),
      orderBy('timestamp', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message));
      setMessages(msgList);
      scrollToBottom();
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'messages');
    });

    return unsubscribe;
  }, [activeChat]);

  const fetchUserProfile = async (uid: string) => {
    try {
      const docRef = doc(db, 'users', uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setUserProfiles(prev => ({ ...prev, [uid]: docSnap.data() as UserProfile }));
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `users/${uid}`);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const openProfileModal = () => {
    if (user) {
      setProfileName(user.displayName || '');
      setProfileAvatar(user.photoURL || '');
      setShowProfileModal(true);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setUpdatingProfile(true);
    try {
      // Update Firebase Auth
      await updateProfile(user, {
        displayName: profileName,
        photoURL: profileAvatar
      });

      // Update Firestore
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        name: profileName,
        avatar: profileAvatar
      });

      // Update local state
      setUser({ ...user, displayName: profileName, photoURL: profileAvatar } as FirebaseUser);
      setUserProfiles(prev => ({
        ...prev,
        [user.uid]: { ...prev[user.uid], name: profileName, avatar: profileAvatar }
      }));
      setShowProfileModal(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setUpdatingProfile(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = (e.target as any).email.value;
    const password = (e.target as any).password.value;
    const name = authMode === 'signup' ? (e.target as any).name.value : '';

    try {
      if (authMode === 'login') {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        await setDoc(doc(db, 'users', user.uid), {
          uid: user.uid,
          name: name || email.split('@')[0],
          email: email,
          status: 'online',
          lastSeen: serverTimestamp(),
          createdAt: serverTimestamp()
        });
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Auth failed');
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Google sign in failed');
    }
  };

  const handleLogout = async () => {
    if (user) {
      try {
        await updateDoc(doc(db, 'users', user.uid), {
          status: 'offline',
          lastSeen: serverTimestamp()
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      }
    }
    await signOut(auth);
    setActiveChat(null);
  };

  const handleSendMessage = async (e?: React.FormEvent, type: 'text' | 'image' | 'video' = 'text', content?: string) => {
    if (e) e.preventDefault();
    if (type === 'text' && !messageInput.trim() && !content) return;
    if ((type === 'image' || type === 'video') && !content) return;
    if (!activeChat || !user) return;

    const text = type === 'text' ? (content || messageInput) : '';
    const fileUrl = (type === 'image' || type === 'video') ? content : '';
    
    if (type === 'text') setMessageInput('');

    try {
      const messageData: any = {
        chatId: activeChat.id,
        senderId: user.uid,
        type: type,
        timestamp: serverTimestamp()
      };

      if (type === 'text') messageData.text = text;
      if (type === 'image') messageData.imageUrl = fileUrl;
      if (type === 'video') messageData.videoUrl = fileUrl;

      await addDoc(collection(db, 'messages'), messageData);

      let lastMsgText = '';
      if (type === 'text') lastMsgText = text;
      else if (type === 'image') lastMsgText = 'Sent a photo';
      else if (type === 'video') lastMsgText = 'Sent a video';

      await updateDoc(doc(db, 'chats', activeChat.id), {
        lastMessage: lastMsgText,
        lastUpdated: serverTimestamp()
      });
      
      if (type === 'image') {
        setShowImageModal(false);
        setImageUrlInput('');
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'messages');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !activeChat) return;

    // Limit to 20MB for now
    if (file.size > 20 * 1024 * 1024) {
      alert('File is too large. Please select a file smaller than 20MB.');
      return;
    }

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (!isImage && !isVideo) {
      alert('Please select an image or video file.');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadStatus('starting');
    
    try {
      const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
      const fileRef = ref(storage, `chats/${activeChat.id}/${fileName}`);
      
      console.log('Starting upload to:', fileRef.fullPath);
      const task = uploadBytesResumable(fileRef, file);
      setUploadTask(task);

      task.on('state_changed', 
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(Math.round(progress));
          setUploadStatus('uploading');
          console.log(`Upload progress: ${progress}%`);
        }, 
        (error) => {
          setUploadStatus('error');
          if (error.code === 'storage/canceled') {
            console.log('Upload canceled');
          } else {
            console.error('Upload error details:', error);
            alert(`Upload failed: ${error.message} (Code: ${error.code})`);
          }
          setIsUploading(false);
          setUploadTask(null);
        }, 
        async () => {
          try {
            setUploadStatus('finalizing');
            console.log('Upload complete, getting download URL...');
            const downloadURL = await getDownloadURL(task.snapshot.ref);
            await handleSendMessage(undefined, isImage ? 'image' : 'video', downloadURL);
            setIsUploading(false);
            setUploadProgress(0);
            setUploadStatus('idle');
            setUploadTask(null);
          } catch (err) {
            console.error('Error finalizing upload:', err);
            alert('Upload finished but failed to save the message. Please try again.');
            setIsUploading(false);
            setUploadStatus('error');
          }
        }
      );
    } catch (error) {
      console.error('Upload setup failed:', error);
      alert('Failed to start upload. Please check your internet connection.');
      setIsUploading(false);
      setUploadStatus('error');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleStoryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (file.size > 10 * 1024 * 1024) {
      alert('Story file is too large. Please select a file smaller than 10MB.');
      return;
    }

    setIsUploading(true);
    setUploadStatus('starting');
    
    try {
      const fileName = `stories/${user.uid}/${Date.now()}_${file.name}`;
      const fileRef = ref(storage, fileName);
      const task = uploadBytesResumable(fileRef, file);
      
      task.on('state_changed', 
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(Math.round(progress));
          setUploadStatus('uploading');
        },
        (error) => {
          console.error('Story upload error:', error);
          setIsUploading(false);
          setUploadStatus('error');
        },
        async () => {
          const downloadURL = await getDownloadURL(task.snapshot.ref);
          const now = new Date();
          const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours later

          await addDoc(collection(db, 'stories'), {
            userId: user.uid,
            imageUrl: downloadURL,
            timestamp: serverTimestamp(),
            expiresAt: Timestamp.fromDate(expiresAt)
          });

          setIsUploading(false);
          setUploadProgress(0);
          setUploadStatus('idle');
        }
      );
    } catch (error) {
      console.error('Story upload failed:', error);
      setIsUploading(false);
    } finally {
      if (storyInputRef.current) storyInputRef.current.value = '';
    }
  };

  const handleReaction = async (messageId: string, emoji: string) => {
    if (!user) return;
    const message = messages.find(m => m.id === messageId);
    if (!message) return;

    const currentReactions = message.reactions || {};
    const users = currentReactions[emoji] || [];
    
    let newUsers;
    if (users.includes(user.uid)) {
      newUsers = users.filter(uid => uid !== user.uid);
    } else {
      newUsers = [...users, user.uid];
    }

    const newReactions = { ...currentReactions };
    if (newUsers.length === 0) {
      delete newReactions[emoji];
    } else {
      newReactions[emoji] = newUsers;
    }

    try {
      await updateDoc(doc(db, 'messages', messageId), {
        reactions: newReactions
      });
      setReactionPickerMsgId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `messages/${messageId}`);
    }
  };

  const handleSearchUsers = async (queryStr: string) => {
    setSearchQuery(queryStr);
    if (!queryStr.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      // Search by name (prefix match)
      const qName = query(
        collection(db, 'users'),
        where('name', '>=', queryStr),
        where('name', '<=', queryStr + '\uf8ff')
      );
      
      // Also search by email (exact match or prefix)
      const qEmail = query(
        collection(db, 'users'),
        where('email', '>=', queryStr.toLowerCase()),
        where('email', '<=', queryStr.toLowerCase() + '\uf8ff')
      );

      const [snapName, snapEmail] = await Promise.all([getDocs(qName), getDocs(qEmail)]);
      
      const combined = [...snapName.docs, ...snapEmail.docs];
      const uniqueResults = Array.from(new Set(combined.map(d => d.id)))
        .map(id => combined.find(d => d.id === id)!.data() as UserProfile)
        .filter(u => u.uid !== user?.uid);

      setSearchResults(uniqueResults);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'users');
    }
  };

  const startNewChat = async (otherUser: UserProfile) => {
    if (!user) return;

    // Check if chat already exists
    const existingChat = chats.find(c => !c.isGroup && c.members.includes(otherUser.uid));
    if (existingChat) {
      setActiveChat(existingChat);
      setShowNewChatModal(false);
      return;
    }

    try {
      const newChatRef = await addDoc(collection(db, 'chats'), {
        members: [user.uid, otherUser.uid],
        isGroup: false,
        lastUpdated: serverTimestamp(),
        unread: { [user.uid]: 0, [otherUser.uid]: 0 }
      });
      setActiveChat({ id: newChatRef.id, members: [user.uid, otherUser.uid], isGroup: false });
      setShowNewChatModal(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'chats');
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-[#0a0f14]">
        <Loader2 className="w-10 h-10 text-[#00d4aa] animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0f14] flex items-center justify-center p-4">
        <div className="bg-[#111820] border border-[#2a3544] rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
          <div className="p-8 text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-[#00d4aa] to-[#00a088] rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-[#00d4aa]/20">
              <MessageSquare className="w-8 h-8 text-[#0a0f14]" />
            </div>
            <h1 className="text-3xl font-bold text-[#f0f4f8] mb-2 font-['Space_Grotesk']">Conversa</h1>
            <p className="text-[#8899a8]">Connect with friends instantly</p>
          </div>

          <div className="flex border-b border-[#2a3544]">
            <button 
              onClick={() => setAuthMode('login')}
              className={cn(
                "flex-1 py-4 font-semibold transition-all relative",
                authMode === 'login' ? "text-[#00d4aa]" : "text-[#5a6a7a] hover:text-[#8899a8]"
              )}
            >
              Sign In
              {authMode === 'login' && <motion.div layoutId="authTab" className="absolute bottom-0 left-1/4 right-1/4 h-1 bg-[#00d4aa] rounded-t-full" />}
            </button>
            <button 
              onClick={() => setAuthMode('signup')}
              className={cn(
                "flex-1 py-4 font-semibold transition-all relative",
                authMode === 'signup' ? "text-[#00d4aa]" : "text-[#5a6a7a] hover:text-[#8899a8]"
              )}
            >
              Sign Up
              {authMode === 'signup' && <motion.div layoutId="authTab" className="absolute bottom-0 left-1/4 right-1/4 h-1 bg-[#00d4aa] rounded-t-full" />}
            </button>
          </div>

          <div className="p-8">
            <form onSubmit={handleAuth} className="space-y-4">
              {authMode === 'signup' && (
                <input 
                  name="name"
                  type="text" 
                  placeholder="Full name" 
                  required 
                  className="w-full bg-[#1a232e] border border-[#2a3544] rounded-xl px-4 py-3 text-[#f0f4f8] focus:border-[#00d4aa] focus:ring-2 focus:ring-[#00d4aa]/20 outline-none transition-all"
                />
              )}
              <input 
                name="email"
                type="email" 
                placeholder="Email address" 
                required 
                className="w-full bg-[#1a232e] border border-[#2a3544] rounded-xl px-4 py-3 text-[#f0f4f8] focus:border-[#00d4aa] focus:ring-2 focus:ring-[#00d4aa]/20 outline-none transition-all"
              />
              <input 
                name="password"
                type="password" 
                placeholder="Password" 
                required 
                className="w-full bg-[#1a232e] border border-[#2a3544] rounded-xl px-4 py-3 text-[#f0f4f8] focus:border-[#00d4aa] focus:ring-2 focus:ring-[#00d4aa]/20 outline-none transition-all"
              />
              <button 
                type="submit"
                className="w-full bg-[#00d4aa] text-[#0a0f14] font-bold py-3 rounded-xl hover:bg-[#00e6b8] transition-all shadow-lg shadow-[#00d4aa]/20 active:scale-[0.98]"
              >
                {authMode === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            </form>

            <div className="flex items-center gap-4 my-6">
              <div className="flex-1 h-px bg-[#2a3544]" />
              <span className="text-[#5a6a7a] text-sm">or</span>
              <div className="flex-1 h-px bg-[#2a3544]" />
            </div>

            <button 
              onClick={handleGoogleSignIn}
              className="w-full bg-[#1a232e] border border-[#2a3544] text-[#f0f4f8] font-semibold py-3 rounded-xl hover:bg-[#222d3a] transition-all flex items-center justify-center gap-3"
            >
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] bg-[#0a0f14] flex overflow-hidden font-['DM_Sans'] text-[#f0f4f8]">
      {/* Sidebar */}
      <aside className={cn(
        "w-full md:w-[360px] bg-[#111820] border-r border-[#2a3544] flex flex-col flex-shrink-0 transition-all duration-300 z-20",
        !sidebarOpen && "md:-ml-[360px]",
        sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      )}>
        {/* Messenger Style Header */}
        <div className="p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#1a232e] flex items-center justify-center text-[#00d4aa] font-bold text-lg border border-[#2a3544] overflow-hidden">
              {user.photoURL ? <img src={user.photoURL} alt="" /> : user.displayName?.[0] || 'U'}
            </div>
            <h1 className="text-2xl font-bold font-['Space_Grotesk'] tracking-tight text-[#f0f4f8]">Chats</h1>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={openProfileModal}
              className="p-2 bg-[#1a232e] rounded-full text-[#f0f4f8] hover:bg-[#222d3a] transition-all"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setShowNewChatModal(true)}
              className="p-2 bg-[#1a232e] rounded-full text-[#f0f4f8] hover:bg-[#222d3a] transition-all"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="px-4 mb-4">
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5a6a7a] group-focus-within:text-[#00d4aa] transition-all" />
            <input 
              type="text" 
              placeholder="Search" 
              className="w-full bg-[#1a232e] border-none rounded-full pl-11 pr-4 py-2.5 text-sm focus:ring-2 focus:ring-[#00d4aa]/20 outline-none transition-all placeholder-[#5a6a7a]"
            />
          </div>
        </div>

        {/* Stories Section */}
        <div className="px-4 mb-4">
          <h3 className="text-[11px] font-bold text-[#5a6a7a] uppercase tracking-wider mb-3 px-1">Stories</h3>
          <div className="overflow-x-auto flex gap-4 scrollbar-hide pb-1">
            <button 
              onClick={() => storyInputRef.current?.click()}
              className="flex flex-col items-center gap-1 shrink-0 group/story"
            >
              <div className="w-14 h-14 rounded-full bg-[#1a232e] border-2 border-dashed border-[#2a3544] flex items-center justify-center text-[#5a6a7a] group-hover/story:border-[#00d4aa] group-hover/story:text-[#00d4aa] transition-all">
                <Plus className="w-6 h-6" />
              </div>
              <span className="text-[10px] text-[#5a6a7a] group-hover/story:text-[#00d4aa]">Your Story</span>
            </button>
            
            {/* Active Stories from others */}
            {stories.filter(s => s.userId !== user.uid).map(story => {
              const storyUser = userProfiles[story.userId];
              return (
                <button 
                  key={story.id} 
                  onClick={() => setActiveStory(story)}
                  className="flex flex-col items-center gap-1 shrink-0"
                >
                  <div className="relative p-0.5 rounded-full border-2 border-[#00d4aa]">
                    <div className="w-13 h-13 rounded-full bg-[#1a232e] flex items-center justify-center text-[#00d4aa] font-bold border border-[#111820] overflow-hidden">
                      {storyUser?.avatar ? <img src={storyUser.avatar} alt="" className="w-full h-full object-cover" /> : storyUser?.name?.[0]}
                    </div>
                  </div>
                  <span className="text-[10px] text-[#8899a8] truncate w-14 text-center">{storyUser?.name?.split(' ')[0]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Active People Section */}
        <div className="px-4 mb-6">
          <h3 className="text-[11px] font-bold text-[#5a6a7a] uppercase tracking-wider mb-3 px-1">Active Now</h3>
          <div className="overflow-x-auto flex gap-4 scrollbar-hide pb-1">
            {(Object.values(userProfiles) as UserProfile[]).filter(u => u.status === 'online' && u.uid !== user.uid).map(u => (
              <button 
                key={u.uid} 
                onClick={() => {
                  // Find or create chat with this user
                  const existingChat = chats.find(c => !c.isGroup && c.members.includes(u.uid));
                  if (existingChat) {
                    setActiveChat(existingChat);
                    if (window.innerWidth < 768) setSidebarOpen(false);
                  } else {
                    // Start new chat logic could go here
                    setShowNewChatModal(true);
                  }
                }}
                className="flex flex-col items-center gap-1 shrink-0"
              >
                <div className="relative">
                  <div className="w-14 h-14 rounded-full bg-[#1a232e] flex items-center justify-center text-[#00d4aa] font-bold border border-[#2a3544] overflow-hidden">
                    {u.avatar ? <img src={u.avatar} alt="" className="w-full h-full object-cover" /> : u.name[0]}
                  </div>
                  <div className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 bg-[#00d4aa] border-2 border-[#111820] rounded-full shadow-sm" />
                </div>
                <span className="text-[10px] text-[#8899a8] truncate w-14 text-center">{u.name.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto px-2 space-y-1 custom-scrollbar">
          {chats.map(chat => {
            const otherUserId = chat.members.find(m => m !== user.uid);
            const otherUser = otherUserId ? userProfiles[otherUserId] : null;
            const name = chat.isGroup ? chat.name : (otherUser?.name || 'Loading...');
            const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
            const isActive = activeChat?.id === chat.id;

            return (
              <button 
                key={chat.id}
                onClick={() => {
                  setActiveChat(chat);
                  if (window.innerWidth < 768) setSidebarOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl transition-all group relative",
                  isActive ? "chat-item-active" : "hover:bg-[#1a232e]/50"
                )}
              >
                <div className="relative shrink-0">
                  <div className="w-14 h-14 rounded-full bg-[#1a232e] flex items-center justify-center text-[#00d4aa] font-bold text-xl border border-[#2a3544] overflow-hidden">
                    {otherUser?.avatar ? <img src={otherUser.avatar} alt="" className="w-full h-full object-cover" /> : initials}
                  </div>
                  {!chat.isGroup && otherUser?.status === 'online' && (
                    <div className="absolute bottom-1 right-1 w-3.5 h-3.5 bg-[#00d4aa] border-2 border-[#111820] rounded-full shadow-sm" />
                  )}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className={cn("font-bold truncate text-[15px]", isActive ? "text-[#f0f4f8]" : "text-[#f0f4f8]")}>{name}</span>
                    <span className="text-[11px] text-[#5a6a7a]">
                      {chat.lastUpdated ? format(chat.lastUpdated.toDate(), 'HH:mm') : ''}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className={cn(
                      "text-[13px] truncate flex-1",
                      isActive ? "text-[#8899a8]" : "text-[#5a6a7a]"
                    )}>
                      {chat.lastMessage || 'No messages yet'}
                    </p>
                    {chat.unread?.[user.uid] ? (
                      <div className="w-2 h-2 bg-[#00d4aa] rounded-full ml-2" />
                    ) : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Bottom Navigation */}
        <div className="p-3 border-t border-[#2a3544] flex items-center justify-around bg-[#111820]">
          <button className="p-2 text-[#00d4aa] flex flex-col items-center gap-1">
            <MessageSquare className="w-6 h-6" />
            <span className="text-[10px] font-bold">Chats</span>
          </button>
          <button 
            onClick={() => setShowNewChatModal(true)}
            className="p-2 text-[#5a6a7a] flex flex-col items-center gap-1 hover:text-[#00d4aa] transition-all"
          >
            <UserIcon className="w-6 h-6" />
            <span className="text-[10px] font-bold">People</span>
          </button>
          <button onClick={handleLogout} className="p-2 text-[#5a6a7a] flex flex-col items-center gap-1 hover:text-[#ff4757]">
            <LogOut className="w-6 h-6" />
            <span className="text-[10px] font-bold">Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col relative min-w-0 bg-[#0a0f14]">
        {activeChat ? (
          <>
            {/* Chat Header */}
            <header className="h-16 md:h-[72px] px-4 md:px-6 border-b border-[#2a3544] flex items-center justify-between bg-[#111820]/80 backdrop-blur-md z-10">
              <div className="flex items-center gap-3 md:gap-4 min-w-0">
                <button 
                  onClick={() => setSidebarOpen(true)}
                  className="md:hidden p-2 -ml-2 text-[#5a6a7a] hover:text-[#f0f4f8]"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <div className="relative shrink-0">
                  <div className="w-10 h-10 rounded-full bg-[#1a232e] flex items-center justify-center text-[#00d4aa] font-bold border border-[#2a3544] overflow-hidden">
                    {(() => {
                      const otherUserId = activeChat.members.find(m => m !== user.uid);
                      const otherUser = otherUserId ? userProfiles[otherUserId] : null;
                      return otherUser?.avatar ? <img src={otherUser.avatar} alt="" className="w-full h-full object-cover" /> : (activeChat.isGroup ? activeChat.name[0] : otherUser?.name?.[0] || '?');
                    })()}
                  </div>
                  {(() => {
                    const otherUserId = activeChat.members.find(m => m !== user.uid);
                    const otherUser = otherUserId ? userProfiles[otherUserId] : null;
                    return !activeChat.isGroup && otherUser?.status === 'online' && (
                      <div className="absolute bottom-0 right-0 w-3 h-3 bg-[#00d4aa] border-2 border-[#111820] rounded-full" />
                    );
                  })()}
                </div>
                <div className="min-w-0">
                  <h2 className="font-bold truncate text-[#f0f4f8]">
                    {activeChat.isGroup ? activeChat.name : (activeChat.members.find(m => m !== user.uid) ? userProfiles[activeChat.members.find(m => m !== user.uid)!]?.name : 'Loading...')}
                  </h2>
                  <p className="text-[11px] text-[#00d4aa] font-medium">
                    {(() => {
                      const otherUserId = activeChat.members.find(m => m !== user.uid);
                      const otherUser = otherUserId ? userProfiles[otherUserId] : null;
                      return otherUser?.status === 'online' ? 'Active now' : 'Offline';
                    })()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button 
                  onClick={() => setShowCallModal({ type: 'voice', active: true })}
                  className="p-2.5 text-[#00d4aa] hover:bg-[#1a232e] rounded-full transition-all"
                >
                  <Phone className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => setShowCallModal({ type: 'video', active: true })}
                  className="p-2.5 text-[#00d4aa] hover:bg-[#1a232e] rounded-full transition-all"
                >
                  <Video className="w-5 h-5" />
                </button>
                <button className="p-2.5 text-[#00d4aa] hover:bg-[#1a232e] rounded-full transition-all">
                  <Info className="w-5 h-5" />
                </button>
              </div>
            </header>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 custom-scrollbar bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] bg-fixed">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center px-10">
                  <div className="w-20 h-20 rounded-full bg-[#1a232e] flex items-center justify-center mb-4 border border-[#2a3544]">
                    <MessageSquare className="w-10 h-10 text-[#00d4aa]" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">No messages yet</h3>
                  <p className="text-[#5a6a7a] max-w-xs">Start the conversation by sending a message below.</p>
                </div>
              ) : (
                messages.map((msg, idx) => {
                  const isOwn = msg.senderId === user.uid;
                  const showAvatar = !isOwn && (idx === messages.length - 1 || messages[idx + 1].senderId !== msg.senderId);
                  const isLastInGroup = idx === messages.length - 1 || messages[idx + 1].senderId !== msg.senderId;
                  const isFirstInGroup = idx === 0 || messages[idx - 1].senderId !== msg.senderId;

                  return (
                    <motion.div 
                      key={msg.id}
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      className={cn(
                        "flex items-end gap-2 max-w-[85%] md:max-w-[70%] group/msg",
                        isOwn ? "ml-auto flex-row-reverse" : "mr-auto"
                      )}
                    >
                      {!isOwn && (
                        <div className="w-8 h-8 shrink-0">
                          {showAvatar ? (
                            <div className="w-8 h-8 rounded-full bg-[#1a232e] flex items-center justify-center text-[10px] font-bold border border-[#2a3544] overflow-hidden">
                              {userProfiles[msg.senderId]?.avatar ? <img src={userProfiles[msg.senderId].avatar} alt="" className="w-full h-full object-cover" /> : userProfiles[msg.senderId]?.name?.[0]}
                            </div>
                          ) : <div className="w-8" />}
                        </div>
                      )}
                      <div className="flex flex-col gap-0.5 relative">
                        {/* Reaction Picker Trigger */}
                        <div className={cn(
                          "absolute top-0 transition-opacity z-10",
                          isOwn ? "right-full mr-2" : "left-full ml-2",
                          "opacity-0 group-hover/msg:opacity-100 md:opacity-0 sm:opacity-100" // Visible on mobile, hover on desktop
                        )}>
                          <motion.button
                            whileTap={{ scale: 0.9 }}
                            onClick={() => setReactionPickerMsgId(reactionPickerMsgId === msg.id ? null : msg.id)}
                            className="p-2 bg-[#1a232e] border border-[#2a3544] rounded-full text-[#5a6a7a] hover:text-[#00d4aa] transition-all shadow-lg"
                          >
                            <Smile className="w-5 h-5" />
                          </motion.button>
                        </div>

                        {/* Reaction Picker */}
                        <AnimatePresence>
                          {reactionPickerMsgId === msg.id && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.8, y: -10 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.8, y: -10 }}
                              className={cn(
                                "absolute top-full mt-2 bg-[#1a232e] border border-[#2a3544] rounded-full p-2 flex gap-2 shadow-2xl z-30",
                                isOwn ? "right-0" : "left-0"
                              )}
                            >
                              {['👍', '❤️', '😂', '😮', '😢', '🔥'].map(emoji => (
                                <motion.button
                                  key={emoji}
                                  whileHover={{ scale: 1.2 }}
                                  whileTap={{ scale: 0.9 }}
                                  onClick={() => handleReaction(msg.id, emoji)}
                                  className="text-2xl p-2 hover:bg-[#2a3544] rounded-full transition-all min-w-[40px] min-h-[40px] flex items-center justify-center"
                                >
                                  {emoji}
                                </motion.button>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>

                        <div className={cn(
                          "px-4 py-2.5 text-[15px] shadow-sm relative",
                          isOwn ? "message-bubble-own" : "message-bubble-other",
                          (msg.type === 'image' || msg.type === 'video') && "p-1 bg-transparent border-none shadow-none",
                          msg.reactions && Object.keys(msg.reactions).length > 0 && "mb-3",
                          isOwn && isFirstInGroup && isLastInGroup && "rounded-2xl",
                          isOwn && isFirstInGroup && !isLastInGroup && "rounded-t-2xl rounded-l-2xl rounded-br-md",
                          isOwn && !isFirstInGroup && !isLastInGroup && "rounded-l-2xl rounded-r-md",
                          isOwn && !isFirstInGroup && isLastInGroup && "rounded-b-2xl rounded-l-2xl rounded-tr-md",
                          !isOwn && isFirstInGroup && isLastInGroup && "rounded-2xl",
                          !isOwn && isFirstInGroup && !isLastInGroup && "rounded-t-2xl rounded-r-2xl rounded-bl-md",
                          !isOwn && !isFirstInGroup && !isLastInGroup && "rounded-r-2xl rounded-l-md",
                          !isOwn && !isFirstInGroup && isLastInGroup && "rounded-b-2xl rounded-r-2xl rounded-tl-md"
                        )}>
                          {msg.type === 'image' ? (
                            <img 
                              src={msg.imageUrl} 
                              alt="Sent image" 
                              className="max-w-full rounded-xl object-cover max-h-[300px] cursor-pointer hover:opacity-90 transition-opacity"
                              onClick={() => window.open(msg.imageUrl, '_blank')}
                            />
                          ) : msg.type === 'video' ? (
                            <video 
                              src={msg.videoUrl} 
                              controls 
                              className="max-w-full rounded-xl max-h-[300px]"
                            />
                          ) : msg.text}
                          
                          {/* Reactions Display */}
                          {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                            <div className={cn(
                              "absolute -bottom-4 flex flex-wrap gap-1.5",
                              isOwn ? "right-2" : "left-2"
                            )}>
                              {Object.entries(msg.reactions).map(([emoji, uids]) => {
                                const userIds = uids as string[];
                                return (
                                  <motion.button
                                    key={emoji}
                                    whileTap={{ scale: 0.9 }}
                                    onClick={() => handleReaction(msg.id, emoji)}
                                    className={cn(
                                      "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-bold border transition-all shadow-sm",
                                      userIds.includes(user.uid) 
                                        ? "bg-[#00d4aa]/20 border-[#00d4aa] text-[#00d4aa]" 
                                        : "bg-[#1a232e] border-[#2a3544] text-[#8899a8]"
                                    )}
                                  >
                                    <span className="text-sm">{emoji}</span>
                                    {userIds.length > 1 && <span>{userIds.length}</span>}
                                  </motion.button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        {isLastInGroup && (
                          <span className={cn(
                            "text-[10px] text-[#5a6a7a] mt-1",
                            isOwn ? "text-right" : "text-left",
                            msg.reactions && Object.keys(msg.reactions).length > 0 && "mt-7"
                          )}>
                            {msg.timestamp ? format(msg.timestamp.toDate(), 'HH:mm') : 'Sending...'}
                          </span>
                        )}
                      </div>
                    </motion.div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="p-3 md:p-4 bg-[#111820] border-t border-[#2a3544]">
              <input 
                type="file" 
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept="image/*,video/*"
                className="hidden"
              />
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="flex items-center gap-3"
              >
                <div className="relative">
                  <button 
                    type="button" 
                    onClick={() => setShowPlusMenu(!showPlusMenu)}
                    className="p-2 text-[#00d4aa] hover:bg-[#1a232e] rounded-full transition-all"
                  >
                    <PlusCircle className="w-6 h-6" />
                  </button>
                  <AnimatePresence>
                    {showPlusMenu && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.9 }}
                        className="absolute bottom-full left-0 mb-2 bg-[#1a232e] border border-[#2a3544] rounded-2xl p-2 shadow-2xl min-w-[200px] z-30"
                      >
                        <button 
                          type="button"
                          onClick={() => {
                            setShowPlusMenu(false);
                            fileInputRef.current?.click();
                          }}
                          className="w-full text-left p-3 hover:bg-[#2a3544] rounded-xl text-sm transition-all flex items-center gap-3"
                        >
                          <Paperclip className="w-4 h-4 text-[#00d4aa]" />
                          <span>Upload File</span>
                        </button>
                        <button 
                          type="button"
                          onClick={() => {
                            setShowPlusMenu(false);
                            setShowImageModal(true);
                          }}
                          className="w-full text-left p-3 hover:bg-[#2a3544] rounded-xl text-sm transition-all flex items-center gap-3"
                        >
                          <Image className="w-4 h-4 text-[#00d4aa]" />
                          <span>Send via URL</span>
                        </button>
                        <button 
                          type="button"
                          onClick={() => {
                            setShowPlusMenu(false);
                            alert('Location sharing coming soon!');
                          }}
                          className="w-full text-left p-3 hover:bg-[#2a3544] rounded-xl text-sm transition-all flex items-center gap-3"
                        >
                          <Search className="w-4 h-4 text-[#00d4aa]" />
                          <span>Send Location</span>
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <button 
                  type="button" 
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 text-[#00d4aa] hover:bg-[#1a232e] rounded-full transition-all"
                >
                  <Image className="w-6 h-6" />
                </button>
                <div className="flex-1 relative">
                  {isUploading && (
                    <div className="absolute inset-0 bg-[#1a232e]/95 rounded-full flex items-center justify-center z-10 px-4">
                      <div className="flex-1 h-1.5 bg-[#2a3544] rounded-full overflow-hidden mr-3">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${uploadProgress}%` }}
                          className="h-full bg-[#00d4aa]"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-[#00d4aa] font-bold whitespace-nowrap">
                          {uploadStatus === 'starting' && 'Starting...'}
                          {uploadStatus === 'uploading' && `${uploadProgress}%`}
                          {uploadStatus === 'finalizing' && 'Finishing...'}
                        </span>
                        <button 
                          type="button"
                          onClick={() => uploadTask?.cancel()}
                          className="p-1 hover:bg-[#2a3544] rounded-full text-[#ff4757] transition-all"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}
                  <input 
                    type="text" 
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    placeholder="Aa" 
                    className="w-full bg-[#1a232e] border-none rounded-full px-5 py-2.5 text-[15px] focus:ring-2 focus:ring-[#00d4aa]/20 outline-none transition-all placeholder-[#5a6a7a]"
                  />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-[#00d4aa]">
                    <Smile className="w-5 h-5" />
                  </button>
                </div>
                <button 
                  type="submit"
                  disabled={!messageInput.trim()}
                  className={cn(
                    "p-2.5 rounded-full transition-all",
                    messageInput.trim() ? "text-[#00d4aa] hover:bg-[#1a232e]" : "text-[#2a3544]"
                  )}
                >
                  <Send className="w-6 h-6" />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-10 bg-[#0a0f14]">
            <div className="w-24 h-24 rounded-full bg-[#111820] flex items-center justify-center mb-6 border border-[#2a3544] shadow-2xl">
              <MessageSquare className="w-12 h-12 text-[#00d4aa]" />
            </div>
            <h2 className="text-3xl font-bold mb-3 font-['Space_Grotesk']">Select a chat to start messaging</h2>
            <p className="text-[#5a6a7a] max-w-md text-lg">Choose from your existing conversations or start a new one with your friends.</p>
            <button 
              onClick={() => setShowNewChatModal(true)}
              className="mt-8 bg-[#00d4aa] text-[#0a0f14] px-8 py-3 rounded-full font-bold hover:bg-[#00b38f] transition-all shadow-lg shadow-[#00d4aa]/20"
            >
              Start New Conversation
            </button>
          </div>
        )}
      </main>

      {/* New Chat Modal */}
      <AnimatePresence>
        {showNewChatModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowNewChatModal(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#111820] border border-[#2a3544] rounded-3xl w-full max-w-md overflow-hidden relative z-10 shadow-2xl"
            >
              <div className="p-6 border-b border-[#2a3544] flex items-center justify-between">
                <h2 className="text-xl font-bold">New Message</h2>
                <button 
                  onClick={() => {
                    setShowNewChatModal(false);
                    setSearchQuery('');
                    setSearchResults([]);
                  }}
                  className="p-2 hover:bg-[#1a232e] rounded-full transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6">
                <div className="relative mb-6">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5a6a7a]" />
                  <input 
                    type="text" 
                    autoFocus
                    placeholder="To: Type a name or email" 
                    value={searchQuery}
                    onChange={(e) => handleSearchUsers(e.target.value)}
                    className="w-full bg-[#1a232e] border-none rounded-xl pl-11 pr-4 py-3 text-sm focus:ring-2 focus:ring-[#00d4aa]/20 outline-none transition-all"
                  />
                </div>
                <div className="max-h-[300px] overflow-y-auto space-y-2 custom-scrollbar">
                  {searchResults.length > 0 ? (
                    searchResults.map(u => (
                      <button 
                        key={u.uid}
                        onClick={() => startNewChat(u)}
                        className="w-full flex items-center gap-4 p-3 rounded-2xl hover:bg-[#1a232e] transition-all text-left group"
                      >
                        <div className="w-12 h-12 rounded-full bg-[#1a232e] flex items-center justify-center text-[#00d4aa] font-bold border border-[#2a3544] overflow-hidden group-hover:border-[#00d4aa] transition-all">
                          {u.avatar ? <img src={u.avatar} alt="" className="w-full h-full object-cover" /> : u.name[0]}
                        </div>
                        <div>
                          <p className="font-bold text-[#f0f4f8] group-hover:text-[#00d4aa] transition-all">{u.name}</p>
                          <p className="text-xs text-[#5a6a7a]">{u.email}</p>
                        </div>
                      </button>
                    ))
                  ) : searchQuery ? (
                    <div className="text-center py-10 text-[#5a6a7a]">
                      <p>No users found matching "{searchQuery}"</p>
                    </div>
                  ) : (
                    <div className="text-center py-10 text-[#5a6a7a]">
                      <p>Search for friends by name or email</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Profile Modal */}
      <AnimatePresence>
        {showProfileModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowProfileModal(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#111820] border border-[#2a3544] rounded-3xl w-full max-w-md overflow-hidden relative z-10 shadow-2xl"
            >
              <div className="p-6 border-b border-[#2a3544] flex items-center justify-between">
                <h2 className="text-xl font-bold">Edit Profile</h2>
                <button 
                  onClick={() => setShowProfileModal(false)}
                  className="p-2 hover:bg-[#1a232e] rounded-full transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleUpdateProfile} className="p-6 space-y-6">
                <div className="flex flex-col items-center gap-4">
                  <div className="relative group">
                    <div className="w-24 h-24 rounded-full bg-[#1a232e] flex items-center justify-center text-[#00d4aa] text-3xl font-bold border-2 border-[#2a3544] overflow-hidden group-hover:border-[#00d4aa] transition-all">
                      {profileAvatar ? (
                        <img src={profileAvatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        profileName[0] || 'U'
                      )}
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-full cursor-pointer">
                      <Camera className="w-6 h-6 text-white" />
                    </div>
                  </div>
                  <p className="text-xs text-[#5a6a7a]">Profile Picture URL</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-[#5a6a7a] uppercase tracking-wider mb-2">Display Name</label>
                    <input 
                      type="text" 
                      required
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      className="w-full bg-[#1a232e] border border-[#2a3544] rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#00d4aa]/20 focus:border-[#00d4aa] outline-none transition-all"
                      placeholder="Your name"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#5a6a7a] uppercase tracking-wider mb-2">Avatar URL</label>
                    <input 
                      type="url" 
                      value={profileAvatar}
                      onChange={(e) => setProfileAvatar(e.target.value)}
                      className="w-full bg-[#1a232e] border border-[#2a3544] rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#00d4aa]/20 focus:border-[#00d4aa] outline-none transition-all"
                      placeholder="https://example.com/avatar.jpg"
                    />
                  </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setShowProfileModal(false)}
                    className="flex-1 py-3 rounded-xl border border-[#2a3544] hover:bg-[#1a232e] font-bold transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    disabled={updatingProfile}
                    className="flex-1 py-3 bg-[#00d4aa] hover:bg-[#00b894] text-[#111820] rounded-xl font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {updatingProfile ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      'Save Changes'
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      
      {/* Image URL Modal */}
      <AnimatePresence>
        {showImageModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowImageModal(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#111820] border border-[#2a3544] rounded-3xl w-full max-w-md overflow-hidden relative z-10 shadow-2xl"
            >
              <div className="p-6 border-b border-[#2a3544] flex items-center justify-between">
                <h2 className="text-xl font-bold">Send Photo</h2>
                <button 
                  onClick={() => setShowImageModal(false)}
                  className="p-2 hover:bg-[#1a232e] rounded-full transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-sm text-[#5a6a7a]">Paste an image URL to send it to the chat.</p>
                <input 
                  type="url" 
                  autoFocus
                  placeholder="https://example.com/image.jpg" 
                  value={imageUrlInput}
                  onChange={(e) => setImageUrlInput(e.target.value)}
                  className="w-full bg-[#1a232e] border border-[#2a3544] rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#00d4aa]/20 outline-none transition-all"
                />
                {imageUrlInput && (
                  <div className="w-full aspect-video rounded-xl overflow-hidden border border-[#2a3544] bg-[#0a0f14]">
                    <img src={imageUrlInput} alt="Preview" className="w-full h-full object-contain" />
                  </div>
                )}
                <button 
                  onClick={() => handleSendMessage(undefined, 'image', imageUrlInput)}
                  disabled={!imageUrlInput}
                  className="w-full bg-[#00d4aa] text-[#0a0f14] font-bold py-3 rounded-xl hover:bg-[#00e6b8] transition-all disabled:opacity-50"
                >
                  Send Photo
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Call Modal */}
      <AnimatePresence>
        {showCallModal.active && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-[#0a0f14]/90 backdrop-blur-xl"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative z-10 flex flex-col items-center text-center"
            >
              <div className="relative mb-8">
                <div className="w-32 h-32 rounded-full bg-[#1a232e] flex items-center justify-center text-[#00d4aa] text-4xl font-bold border-4 border-[#00d4aa] overflow-hidden animate-pulse">
                  {(() => {
                    const otherUserId = activeChat?.members.find(m => m !== user.uid);
                    const otherUser = otherUserId ? userProfiles[otherUserId] : null;
                    return otherUser?.avatar ? <img src={otherUser.avatar} alt="" className="w-full h-full object-cover" /> : otherUser?.name?.[0];
                  })()}
                </div>
                <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-[#00d4aa] rounded-full flex items-center justify-center text-[#0a0f14] border-4 border-[#0a0f14]">
                  {showCallModal.type === 'voice' ? <Phone className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                </div>
              </div>
              <h2 className="text-3xl font-bold mb-2">
                {(() => {
                  const otherUserId = activeChat?.members.find(m => m !== user.uid);
                  return otherUserId ? userProfiles[otherUserId]?.name : 'Unknown';
                })()}
              </h2>
              <p className="text-[#00d4aa] font-medium mb-12 animate-bounce">
                {showCallModal.type === 'voice' ? 'Voice calling...' : 'Video calling...'}
              </p>
              <div className="flex gap-8">
                <button 
                  onClick={() => setShowCallModal({ ...showCallModal, active: false })}
                  className="w-16 h-16 bg-[#ff4757] rounded-full flex items-center justify-center text-white hover:bg-[#ff6b81] transition-all shadow-lg shadow-[#ff4757]/20"
                >
                  <X className="w-8 h-8" />
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Story Viewer Modal */}
      <AnimatePresence>
        {activeStory && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0"
            />
            <div className="relative w-full max-w-lg h-full md:h-[90vh] flex flex-col">
              {/* Progress Bar */}
              <div className="absolute top-4 left-4 right-4 flex gap-1 z-20">
                <div className="h-1 flex-1 bg-white/20 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 5, ease: 'linear' }}
                    onAnimationComplete={() => setActiveStory(null)}
                    className="h-full bg-white"
                  />
                </div>
              </div>

              {/* Header */}
              <div className="absolute top-8 left-4 right-4 flex items-center justify-between z-20">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full border-2 border-[#00d4aa] overflow-hidden bg-[#1a232e]">
                    {userProfiles[activeStory.userId]?.avatar ? (
                      <img src={userProfiles[activeStory.userId].avatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#00d4aa] font-bold">
                        {userProfiles[activeStory.userId]?.name?.[0]}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="font-bold text-white text-sm shadow-sm">{userProfiles[activeStory.userId]?.name}</p>
                    <p className="text-[10px] text-white/70 shadow-sm">{format(activeStory.timestamp.toDate(), 'HH:mm')}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setActiveStory(null)}
                  className="p-2 text-white hover:bg-white/10 rounded-full transition-all"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 flex items-center justify-center bg-[#0a0f14] rounded-none md:rounded-3xl overflow-hidden relative">
                <img 
                  src={activeStory.imageUrl} 
                  alt="Story" 
                  className="w-full h-full object-contain"
                />
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* Hidden Inputs */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileUpload} 
        accept="image/*,video/*" 
        className="hidden" 
      />
      <input 
        type="file" 
        ref={storyInputRef} 
        onChange={handleStoryUpload} 
        accept="image/*" 
        className="hidden" 
      />
    </div>
  );
}
