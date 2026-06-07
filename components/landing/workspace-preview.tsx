'use client'

import { motion } from 'framer-motion'
import {
  Box,
  Code2,
  FolderOpen,
  Globe,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Send,
} from 'lucide-react'
import { Logo } from '@/components/brand/logo'
import { UI_MODELS } from '@/types/models'

const projects = ['HSC Economics', 'Client Website', 'Startup Research']

const chats = [
  { title: 'Research synthesis', date: 'Today', active: true },
  { title: 'Website artifact', date: 'Today', active: false },
  { title: 'Essay feedback', date: 'Yesterday', active: false },
]

export function WorkspacePreview() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 34 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: 0.32 }}
      className="relative mx-auto mt-16 max-w-7xl md:mt-20"
    >
      <div className="absolute -inset-x-8 -inset-y-6 rounded-[2.5rem] bg-[linear-gradient(110deg,rgba(139,92,246,0.14),rgba(255,255,255,0.04),rgba(34,211,238,0.08))] blur-3xl" />
      <div className="relative overflow-hidden rounded-[2rem] border border-white/[0.08] bg-[#0f0f0f] shadow-2xl shadow-black/50">
        <div className="grid min-h-[700px] lg:grid-cols-[288px_minmax(0,1fr)]">
          <aside className="hidden border-r border-white/[0.05] bg-[#171717] lg:flex lg:flex-col">
            <div className="px-3 pb-2 pt-3">
              <div className="px-2 py-1">
                <Logo size="sm" showText />
              </div>
              <button className="mt-3 flex h-9 w-full items-center justify-start rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 text-sm text-gray-200">
                <Plus className="mr-2 h-4 w-4 text-violet-400" />
                New Chat
              </button>
              <button className="mt-2 flex h-9 w-full items-center justify-start rounded-lg border border-violet-300/[0.12] bg-violet-500/[0.06] px-3 text-sm text-violet-100">
                <Code2 className="mr-2 h-4 w-4 text-violet-300" />
                Easy Code
              </button>
            </div>

            <div className="flex items-center justify-between px-4 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
              <span>Projects</span>
              <span className="rounded px-1.5 py-0.5 text-violet-300">View all</span>
            </div>
            <div className="space-y-px px-2 pb-3">
              {projects.map((project, index) => (
                <div
                  key={project}
                  className={`group flex items-center rounded-lg transition-colors ${
                    index === 0 ? 'bg-violet-500/[0.08]' : 'hover:bg-white/[0.045]'
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left">
                    <FolderOpen className={`h-3.5 w-3.5 shrink-0 ${index === 0 ? 'text-violet-300' : 'text-gray-500'}`} />
                    <span className={`truncate text-sm ${index === 0 ? 'text-white' : 'text-gray-300'}`}>{project}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-4 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
              Recent
            </div>
            <div className="flex-1 space-y-px overflow-y-auto px-2 pb-3">
              {chats.map((chat) => (
                <div
                  key={chat.title}
                  className={`relative w-full rounded-lg px-2.5 py-1.5 text-left ${
                    chat.active ? 'bg-white/[0.07]' : ''
                  }`}
                >
                  <div className="flex items-start gap-2.5 pr-7">
                    <MessageSquare className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${chat.active ? 'text-violet-400' : 'text-gray-500'}`} />
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm leading-snug ${chat.active ? 'text-white' : 'text-gray-200'}`}>{chat.title}</p>
                      <p className="mt-0.5 text-[11px] text-gray-500">{chat.date}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-white/[0.05] p-3">
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
                <p className="text-sm font-medium text-white">EasyPlus workspace</p>
                <p className="mt-1 text-xs leading-5 text-gray-500">
                  Models, files, search, artifacts, and Easy Code in one chat interface.
                </p>
              </div>
            </div>
          </aside>

          <section className="flex min-w-0 flex-col bg-[#0f0f0f]">
            <div className="border-b border-white/[0.06] bg-[#0f0f0f]/95 px-3 py-3 backdrop-blur-md md:px-4">
              <div className="flex flex-wrap items-center gap-2">
                {UI_MODELS.map((model, index) => (
                  <span
                    key={model.id}
                    className={`flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium md:px-3 ${
                      index === 0
                        ? 'border-white/[0.10] bg-white/[0.06] text-white'
                        : 'border-transparent bg-transparent text-gray-300'
                    }`}
                  >
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: model.color }} />
                    <span>{model.name}</span>
                  </span>
                ))}
                <span className="ml-auto flex h-8 items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 text-xs font-medium text-emerald-200 md:px-3">
                  <Globe className="h-3.5 w-3.5" />
                  Search
                </span>
                <span className="flex h-8 items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.02] px-2.5 text-xs font-medium text-gray-300 md:px-3">
                  <Box className="h-3.5 w-3.5" />
                  Artifacts
                </span>
              </div>
            </div>

            <div className="flex-1 px-3 py-4 md:px-4 md:py-5 lg:px-6">
              <div className="mx-auto flex min-h-[560px] max-w-[820px] flex-col justify-center px-1 py-4 sm:px-2 sm:py-6">
                <div className="mx-auto flex w-full max-w-[760px] flex-col items-center gap-4 text-center sm:gap-5">
                  <div className="space-y-2">
                    <h3 className="text-2xl font-semibold tracking-tight text-white sm:text-[2rem]">How can I help?</h3>
                  </div>

                  <div className="w-full">
                    <div className="relative overflow-hidden rounded-[26px] border border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(139,92,246,0.10),transparent_42%),rgba(24,24,24,0.9)] p-3 shadow-[0_18px_60px_rgba(0,0,0,0.32)] backdrop-blur-xl sm:p-4">
                      <div className="flex items-end gap-2">
                        <button
                          type="button"
                          className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.07] bg-white/[0.03] text-gray-400"
                          aria-label="Attach files"
                        >
                          <Paperclip className="h-[18px] w-[18px] md:h-5 md:w-5" />
                        </button>
                        <textarea
                          value=""
                          readOnly
                          placeholder="Start with a prompt, file, search, or artifact."
                          className="min-h-[38px] flex-1 resize-none border-none bg-transparent py-1.5 text-base text-white outline-none placeholder:text-gray-500"
                          rows={1}
                        />
                        <button
                          type="button"
                          className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-600/90 text-white"
                          aria-label="Send message"
                        >
                          <Send className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="mt-3 flex flex-col gap-3 border-t border-white/[0.05] pt-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex flex-wrap gap-2">
                          {['Instant', 'Thinking', 'Extended'].map((mode, index) => (
                            <span
                              key={mode}
                              className={`rounded-full border px-3 py-1 text-[11px] ${
                                index === 0
                                  ? 'border-violet-300/20 bg-violet-500/10 text-violet-100'
                                  : 'border-white/[0.08] bg-white/[0.03] text-gray-400'
                              }`}
                            >
                              {mode}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </motion.div>
  )
}
