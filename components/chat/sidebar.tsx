'use client'

import { useState, useEffect } from 'react'
import {
  Plus,
  MessageSquare,
  Trash2,
  Settings,
  LogOut,
  Menu,
  X,
  CreditCard,
  User,
  Shield,
  Brain,
  FolderOpen,
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
  pendingConversationIds?: string[]
  onSelectConversation: (id: string) => void
  onNewChat: () => void
  onDeleteConversation: (id: string) => void
  userProfile: {
    display_name: string | null
    avatar_url: string | null
    credits: number
    unlimited_credits?: boolean
    role: 'user' | 'sub_admin' | 'admin'
  }
}

export function Sidebar({
  conversations,
  currentConversationId,
  pendingConversationIds = [],
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  userProfile,
}: SidebarProps) {
  const [isOpen, setIsOpen] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  // Prefetch common routes for faster navigation
  useEffect(() => {
    router.prefetch('/dashboard')
    router.prefetch('/billing')
    if (userProfile.role === 'admin' || userProfile.role === 'sub_admin') {
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
        className="fixed left-3 top-3 z-50 h-9 w-9 rounded-lg border border-white/[0.07] bg-[#171717] text-gray-300 hover:bg-[#202020] md:hidden"
      >
        {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>

      <aside
        className={cn(
          'fixed left-0 top-0 z-40 flex h-[100dvh] w-72 flex-col',
          'border-r border-white/[0.05] bg-[#171717]',
          'transition-transform duration-200',
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
            <div className="px-3 pb-2 pt-3">
              <div className="px-2 py-1">
                <Logo size="sm" showText />
              </div>
              <Button onClick={onNewChat} className="mt-3 h-9 w-full justify-start rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 text-sm text-gray-200 hover:bg-white/[0.06] hover:text-white">
                <Plus className="mr-2 h-4 w-4 text-violet-400" />
                New Chat
              </Button>
              <Button onClick={() => router.push('/projects')} className="mt-2 h-9 w-full justify-start rounded-lg border border-white/[0.07] bg-transparent px-3 text-sm text-gray-300 hover:bg-white/[0.05] hover:text-white">
                <FolderOpen className="mr-2 h-4 w-4 text-violet-300" />
                Projects
              </Button>
            </div>

            <div className="px-4 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
              Recent
            </div>
            <div className="flex-1 space-y-px overflow-y-auto px-2 pb-3 scrollbar-thin">
              {conversations.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No conversations yet</p>
                  <p className="text-xs text-gray-500 mt-1">Start a new chat to begin</p>
                </div>
              ) : (
                conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => onSelectConversation(conv.id)}
                    className={cn(
                      'group relative w-full rounded-lg px-2.5 py-1.5 text-left transition-colors',
                      currentConversationId === conv.id
                        ? 'bg-white/[0.07]'
                        : 'hover:bg-white/[0.045]'
                    )}
                  >
                    <div className="flex items-start gap-2.5 pr-7">
                      <MessageSquare className={cn(
                        'mt-0.5 h-3.5 w-3.5 shrink-0 transition-colors',
                        currentConversationId === conv.id ? 'text-violet-400' : 'text-gray-500'
                      )} />
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          'truncate text-sm leading-snug',
                          currentConversationId === conv.id ? 'text-white' : 'text-gray-200'
                        )}>
                          {conv.title}
                        </p>
                        <p className="mt-0.5 text-[11px] text-gray-500">
                          {new Date(conv.created_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: new Date(conv.created_at).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
                          })}
                        </p>
                      </div>
                      {pendingConversationIds.includes(conv.id) && (
                        <span className="absolute top-3 right-10 h-2 w-2 rounded-full bg-violet-400 animate-pulse" />
                      )}
                    </div>
                    <Button
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteConversation(conv.id)
                      }}
                      variant="ghost"
                      size="icon"
                      className="absolute right-2 top-1.5 h-7 w-7 opacity-0 transition-opacity hover:bg-red-500/15 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3 w-3 text-red-400" />
                    </Button>
                  </button>
                ))
              )}
            </div>

            <div className="border-t border-white/[0.05] p-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.05]">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={userProfile.avatar_url || undefined} />
                      <AvatarFallback className="border border-white/[0.08] bg-[#292929] text-xs text-gray-200">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-200">{userProfile.display_name || 'User'}</p>
                      <p className="truncate text-[11px] text-gray-500">
                        {userProfile.unlimited_credits || userProfile.role === 'admin' ? 'Unlimited credits' : `${formatCredits(userProfile.credits)} credits`}
                      </p>
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="w-64 border-white/[0.08] bg-[#202020]">
                  <DropdownMenuItem onClick={() => router.push('/dashboard')}><User className="mr-2 h-4 w-4" />Dashboard</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push('/billing')}><CreditCard className="mr-2 h-4 w-4" />Credits</DropdownMenuItem>
                  {(userProfile.role === 'admin' || userProfile.role === 'sub_admin') && <DropdownMenuItem onClick={() => router.push('/admin')}><Shield className="mr-2 h-4 w-4" />Admin Panel</DropdownMenuItem>}
                  <DropdownMenuItem onClick={() => router.push('/settings/memory')}><Brain className="mr-2 h-4 w-4" />Memory</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push('/settings')}><Settings className="mr-2 h-4 w-4" />Settings</DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem onClick={handleSignOut}><LogOut className="mr-2 h-4 w-4" />Sign Out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
      </aside>

      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  )
}
