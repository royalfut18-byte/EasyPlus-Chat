'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  PlusCircle,
  MessageSquare,
  Trash2,
  Settings,
  LogOut,
  Menu,
  X,
  CreditCard,
  User,
  Shield,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn, formatCredits } from '@/lib/utils'
import { Logo } from '@/components/brand/logo'
import type { Conversation } from '@/types/models'

interface SidebarProps {
  conversations: Conversation[]
  currentConversationId?: string
  onSelectConversation: (id: string) => void
  onNewChat: () => void
  onDeleteConversation: (id: string) => void
  userProfile: {
    display_name: string | null
    avatar_url: string | null
    credits: number
    role: 'user' | 'admin'
  }
}

export function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  userProfile,
}: SidebarProps) {
  const [isOpen, setIsOpen] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  // Prefetch common routes for faster navigation
  useEffect(() => {
    router.prefetch('/dashboard')
    router.prefetch('/billing')
    if (userProfile.role === 'admin') {
      router.prefetch('/admin')
    }
  }, [router, userProfile.role])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const initials = userProfile.display_name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase() || 'U'

  return (
    <>
      <Button
        onClick={() => setIsOpen(!isOpen)}
        variant="ghost"
        size="icon"
        className="fixed top-4 left-4 z-50 md:hidden glass"
      >
        {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>

      <AnimatePresence>
        {isOpen && (
          <motion.aside
            initial={{ x: -320 }}
            animate={{ x: 0 }}
            exit={{ x: -320 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className={cn(
              'fixed left-0 top-0 h-screen w-80 z-40',
              'glass-strong border-r border-white/10',
              'flex flex-col'
            )}
          >
            <div className="p-4 border-b border-white/10">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1">
                  <Logo size="sm" showText />
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="rounded-full">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={userProfile.avatar_url || undefined} />
                        <AvatarFallback className="gradient-primary text-white text-xs">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 glass-strong border-white/10">
                    <div className="px-2 py-2">
                      <p className="text-sm font-medium text-white">
                        {userProfile.display_name || 'User'}
                      </p>
                      <p className="text-xs text-gray-400">
                        {formatCredits(userProfile.credits)} credits
                      </p>
                    </div>
                    <DropdownMenuSeparator className="bg-white/10" />
                    <DropdownMenuItem onClick={() => router.push('/dashboard')}>
                      <User className="mr-2 h-4 w-4" />
                      Dashboard
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => router.push('/billing')}>
                      <CreditCard className="mr-2 h-4 w-4" />
                      Credits
                    </DropdownMenuItem>
                    {userProfile.role === 'admin' && (
                      <DropdownMenuItem onClick={() => router.push('/admin')}>
                        <Shield className="mr-2 h-4 w-4" />
                        Admin Panel
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => router.push('/settings')}>
                      <Settings className="mr-2 h-4 w-4" />
                      Settings
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-white/10" />
                    <DropdownMenuItem onClick={handleSignOut}>
                      <LogOut className="mr-2 h-4 w-4" />
                      Sign Out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <Button onClick={onNewChat} className="w-full gradient-primary" size="lg">
                <PlusCircle className="mr-2 h-4 w-4" />
                New Chat
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin">
              {conversations.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No conversations yet</p>
                  <p className="text-xs text-gray-500 mt-1">Start a new chat to begin</p>
                </div>
              ) : (
                conversations.map((conv) => (
                  <motion.button
                    key={conv.id}
                    onClick={() => onSelectConversation(conv.id)}
                    className={cn(
                      'w-full text-left p-3 rounded-xl transition-all group relative',
                      currentConversationId === conv.id
                        ? 'bg-gradient-to-r from-purple-500/20 to-blue-500/20 glow-border shadow-lg'
                        : 'hover:bg-white/5 border border-transparent hover:border-white/10'
                    )}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                  >
                    <div className="flex items-start gap-3 pr-8">
                      <MessageSquare className={cn(
                        'h-4 w-4 mt-1 shrink-0 transition-colors',
                        currentConversationId === conv.id ? 'text-purple-400' : 'text-gray-400'
                      )} />
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          'text-sm font-medium truncate leading-snug',
                          currentConversationId === conv.id ? 'text-white' : 'text-gray-200'
                        )}>
                          {conv.title}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {new Date(conv.created_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: new Date(conv.created_at).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
                          })}
                        </p>
                      </div>
                    </div>
                    <Button
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteConversation(conv.id)
                      }}
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/20"
                    >
                      <Trash2 className="h-3 w-3 text-red-400" />
                    </Button>
                  </motion.button>
                ))
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  )
}
