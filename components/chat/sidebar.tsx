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
  Code2,
  ChevronDown,
  ChevronRight,
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
  projects?: Array<{
    id: string
    name: string
    conversations: Conversation[]
  }>
  activeProjectId?: string | null
  currentConversationId?: string
  pendingConversationIds?: string[]
  onSelectConversation: (id: string, projectId?: string | null) => void
  onNewChat: () => void
  onNewProjectChat?: (projectId: string) => void
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
  projects = [],
  activeProjectId,
  currentConversationId,
  pendingConversationIds = [],
  onSelectConversation,
  onNewChat,
  onNewProjectChat,
  onDeleteConversation,
  userProfile,
}: SidebarProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({})
  const router = useRouter()
  const supabase = createClient()

  // Prefetch common routes for faster navigation
  useEffect(() => {
    router.prefetch('/dashboard')
    router.prefetch('/billing')
    router.prefetch('/projects')
    if (userProfile.role === 'admin' || userProfile.role === 'sub_admin') {
      router.prefetch('/admin')
    }
  }, [router, userProfile.role])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    window.location.assign('/login')
  }

  const closeDrawer = () => setIsOpen(false)
  const navigateFromDrawer = (href: string) => {
    closeDrawer()
    router.push(href)
  }

  const initials = userProfile.display_name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase() || 'U'

  useEffect(() => {
    if (!activeProjectId) return
    setExpandedProjects(prev => ({ ...prev, [activeProjectId]: true }))
  }, [activeProjectId])

  const toggleProject = (projectId: string) => {
    setExpandedProjects(prev => ({ ...prev, [projectId]: !prev[projectId] }))
  }

  return (
    <>
      <Button
        onClick={() => setIsOpen(!isOpen)}
        variant="ghost"
        size="icon"
        className="fixed left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-50 h-9 w-9 rounded-lg border border-white/[0.07] bg-[#171717] text-gray-300 hover:bg-[#202020] md:hidden"
        aria-label={isOpen ? 'Close menu' : 'Open menu'}
      >
        {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>

      <aside
        className={cn(
          'fixed left-0 top-0 z-40 flex h-[100dvh] w-[min(18rem,86vw)] flex-col pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]',
          'border-r border-white/[0.05] bg-[#171717]',
          'transition-transform duration-200',
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
            <div className="px-3 pb-2 pt-3">
              <div className="px-2 py-1">
                <Logo size="sm" showText />
              </div>
              <Button onClick={() => { closeDrawer(); onNewChat() }} className="mt-3 h-9 w-full justify-start rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 text-sm text-gray-200 hover:bg-white/[0.06] hover:text-white">
                <Plus className="mr-2 h-4 w-4 text-violet-400" />
                New Chat
              </Button>
              <Button onClick={() => navigateFromDrawer('/easy-code')} className="mt-2 h-9 w-full justify-start rounded-lg border border-violet-300/[0.12] bg-violet-500/[0.06] px-3 text-sm text-violet-100 hover:bg-violet-500/[0.12] hover:text-white">
                <Code2 className="mr-2 h-4 w-4 text-violet-300" />
                Easy Code
              </Button>
            </div>

            <div className="flex items-center justify-between px-4 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
              <span>Projects</span>
              <button onClick={() => navigateFromDrawer('/projects')} className="rounded px-1.5 py-0.5 text-violet-300 transition-colors hover:bg-white/[0.05] hover:text-white" title="View all projects">
                View all
              </button>
            </div>
            <div className="space-y-px px-2 pb-2">
              {projects.length === 0 ? (
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2">
                  <button onClick={() => navigateFromDrawer('/projects')} className="w-full rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[0.045]">
                    <p className="text-sm font-medium text-gray-200">Create your first project</p>
                    <p className="mt-1 text-[11px] text-gray-500">Start a project to group chats, files, and artifacts.</p>
                  </button>
                  <button
                    onClick={() => navigateFromDrawer('/projects')}
                    className="mt-1 flex w-full items-center gap-2 rounded-lg border border-violet-300/[0.12] bg-violet-500/[0.06] px-2.5 py-2 text-xs font-medium text-violet-100 transition-colors hover:bg-violet-500/[0.12] hover:text-white"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New project
                  </button>
                </div>
              ) : projects.map(project => {
                const expanded = !!expandedProjects[project.id]
                const isActive = activeProjectId === project.id
                return (
                  <div key={project.id}>
                    <div className={cn('group flex items-center rounded-lg transition-colors', isActive ? 'bg-violet-500/[0.08]' : 'hover:bg-white/[0.045]')}>
                      <button onClick={() => toggleProject(project.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left">
                        {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-500" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-500" />}
                        <FolderOpen className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-violet-300' : 'text-gray-500')} />
                        <span className={cn('truncate text-sm', isActive ? 'text-white' : 'text-gray-300')}>{project.name}</span>
                      </button>
                      <button onClick={() => { closeDrawer(); onNewProjectChat?.(project.id) }} className="mr-1 rounded p-1 text-gray-500 opacity-100 transition-all hover:bg-white/[0.08] hover:text-violet-300 md:opacity-0 md:group-hover:opacity-100" title={`New chat in ${project.name}`}>
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {expanded && (
                      <div className="ml-5 border-l border-white/[0.06] pl-2">
                        <button onClick={() => { closeDrawer(); onNewProjectChat?.(project.id) }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-gray-500 transition-colors hover:bg-white/[0.04] hover:text-violet-200">
                          <Plus className="h-3 w-3" />
                          New chat
                        </button>
                        {project.conversations.length === 0 ? (
                          <p className="px-2 py-1.5 text-[11px] text-gray-600">No chats in this project yet</p>
                        ) : project.conversations.slice(0, 5).map(conv => (
                          <button key={conv.id} onClick={() => { closeDrawer(); onSelectConversation(conv.id, project.id) }} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors', currentConversationId === conv.id ? 'bg-white/[0.07] text-white' : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-200')}>
                            <MessageSquare className="h-3 w-3 shrink-0" />
                            <span className="truncate text-xs">{conv.title}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="px-4 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
              Recent
            </div>
            <div className="flex-1 space-y-px overflow-y-auto px-2 pb-3 scrollbar-thin">
              {conversations.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No normal chats yet</p>
                  <p className="text-xs text-gray-500 mt-1">Start a new chat or open a project</p>
                </div>
              ) : (
                conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => { closeDrawer(); onSelectConversation(conv.id, null) }}
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
                  <DropdownMenuItem onClick={() => navigateFromDrawer('/dashboard')}><User className="mr-2 h-4 w-4" />Dashboard</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigateFromDrawer('/billing')}><CreditCard className="mr-2 h-4 w-4" />Credits</DropdownMenuItem>
                  {(userProfile.role === 'admin' || userProfile.role === 'sub_admin') && <DropdownMenuItem onClick={() => navigateFromDrawer('/admin')}><Shield className="mr-2 h-4 w-4" />Admin Panel</DropdownMenuItem>}
                  <DropdownMenuItem onClick={() => navigateFromDrawer('/settings/memory')}><Brain className="mr-2 h-4 w-4" />Memory</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigateFromDrawer('/settings')}><Settings className="mr-2 h-4 w-4" />Settings</DropdownMenuItem>
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
