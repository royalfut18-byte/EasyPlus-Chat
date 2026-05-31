'use client'

import { motion } from 'framer-motion'
import { MessageSquare, Search, Box, Send, Globe, Sparkles, Image as ImageIcon, Plus, Paperclip } from 'lucide-react'
import { ChatGPTIcon } from '@/components/icons/chatgpt-icon'
import { AnthropicIcon } from '@/components/icons/anthropic-icon'
import { Logo } from '@/components/brand/logo'

const conversations = [
  { title: 'Latest AI News', active: true, date: 'Today' },
  { title: 'Code Review Help', active: false, date: 'Today' },
  { title: 'Research Summary', active: false, date: 'Yesterday' },
  { title: 'Web Search Test', active: false, date: 'May 29' },
]

const models = [
  { name: 'Claude Opus 4.7', icon: <AnthropicIcon className="h-3.5 w-3.5" />, color: '#d97757', active: true },
  { name: 'Chat GPT 5.5', icon: <ChatGPTIcon className="h-3.5 w-3.5" />, color: '#10a37f', active: false },
  { name: 'Gemini 3.1 Pro', icon: <Sparkles className="h-3.5 w-3.5" />, color: '#4285f4', active: false },
]

const modes = ['Instant', 'Thinking', 'Extended']

export function WorkspacePreview() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8 }}
      className="mx-auto mb-20 max-w-7xl px-0 sm:px-4 md:mb-32"
    >
      <div className="mb-12 space-y-3 px-4 text-center md:mb-16 md:space-y-4">
        <h2 className="text-3xl font-bold md:text-4xl lg:text-5xl">See the workspace in action.</h2>
        <p className="mx-auto max-w-3xl text-base text-gray-400 md:text-lg lg:text-xl">
          Search the web, switch models, create artifacts, upload images, and keep conversations organized - all from one private chat interface.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, delay: 0.15 }}
        className="relative"
      >
        <div className="absolute -inset-x-6 -inset-y-4 rounded-3xl bg-[linear-gradient(115deg,rgba(124,58,237,0.08),rgba(255,255,255,0.02),rgba(6,182,212,0.05))] blur-3xl" />

        <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f0f0f] shadow-2xl shadow-black/50">
          <div className="flex items-center gap-3 border-b border-white/[0.06] bg-[#171717] px-3 py-3 md:px-4">
            <div className="flex gap-1.5">
              <div className="h-3 w-3 rounded-full bg-red-500/45" />
              <div className="h-3 w-3 rounded-full bg-yellow-500/45" />
              <div className="h-3 w-3 rounded-full bg-green-500/45" />
            </div>
            <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
              <Logo size="sm" />
              <span className="truncate text-xs text-gray-300 md:text-sm">EasyPlus AI</span>
            </div>
            <div className="hidden items-center gap-1.5 text-[11px] text-emerald-300 sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Live
            </div>
          </div>

          <div className="flex min-h-[560px] md:h-[620px]">
            <aside className="hidden w-72 shrink-0 border-r border-white/[0.06] bg-[#171717] p-3 md:flex md:flex-col">
              <div className="px-2 py-1">
                <Logo size="sm" showText />
              </div>

              <button className="mt-3 flex h-10 items-center rounded-lg border border-white/[0.08] px-3 text-sm text-gray-200">
                <Plus className="mr-2 h-4 w-4 text-violet-400" />
                New Chat
              </button>

              <div className="px-2 pb-1 pt-5 text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500">
                Recent
              </div>

              <div className="space-y-0.5">
                {conversations.map((conv) => (
                  <div
                    key={conv.title}
                    className={`rounded-lg px-2.5 py-2 ${
                      conv.active ? 'bg-white/[0.08]' : 'bg-transparent'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <MessageSquare className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${conv.active ? 'text-violet-400' : 'text-gray-500'}`} />
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm leading-snug ${conv.active ? 'text-white' : 'text-gray-300'}`}>
                          {conv.title}
                        </p>
                        <p className="mt-0.5 text-[11px] text-gray-500">{conv.date}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-auto border-t border-white/[0.06] pt-3">
                <div className="flex items-center gap-3 rounded-lg px-2 py-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600/80 text-xs font-semibold text-white">
                    E
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-200">EasyPlus User</p>
                    <p className="text-[11px] text-gray-500">12.4K credits</p>
                  </div>
                </div>
              </div>
            </aside>

            <main className="flex min-w-0 flex-1 flex-col bg-[#0f0f0f]">
              <div className="border-b border-white/[0.06] bg-[#0f0f0f]/95 px-3 py-2 md:px-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {models.map((model) => (
                      <div
                        key={model.name}
                        className={`flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium ${
                          model.active
                            ? 'border-white/[0.12] bg-white/[0.08] text-white'
                            : 'border-transparent text-gray-400'
                        }`}
                      >
                        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white/[0.05]" style={{ color: model.color }}>
                          {model.icon}
                        </span>
                        <span className="hidden truncate sm:inline">{model.name}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <div className="flex h-8 items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.02] px-2.5 text-xs text-gray-300">
                      <Globe className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Search</span>
                    </div>
                    <div className="flex h-8 items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.02] px-2.5 text-xs text-gray-300">
                      <Box className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Artifacts</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-hidden px-4 py-5 md:px-8">
                <div className="mx-auto flex h-full max-w-3xl flex-col justify-end gap-5">
                  <div className="flex justify-end">
                    <div className="max-w-[84%] rounded-3xl bg-violet-600/85 px-4 py-3 text-sm leading-6 text-white md:max-w-[70%]">
                      What's the latest news about AI today? Search the web.
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white/[0.05] text-[#d97757]">
                        <AnthropicIcon className="h-3.5 w-3.5" />
                      </span>
                      Claude Opus 4.7
                    </div>

                    <div className="space-y-3 text-sm leading-6 text-gray-100">
                      <div className="flex items-center gap-2 text-gray-400">
                        <Search className="h-4 w-4 animate-pulse text-violet-400" />
                        <span>Searching the web...</span>
                      </div>

                      <p>Based on recent web search results, here are today's key AI developments:</p>
                      <ul className="space-y-1 pl-5">
                        <li>OpenAI releases new safety research framework</li>
                        <li>Claude Opus 4.7 advances in reasoning capabilities</li>
                        <li>DeepMind achieves breakthrough in protein folding</li>
                      </ul>

                      <div className="flex flex-wrap gap-2 pt-1">
                        {['TechCrunch', 'The Verge', 'MIT Tech'].map((source) => (
                          <span key={source} className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs text-gray-300">
                            {source}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Sparkles className="h-4 w-4 animate-pulse text-violet-400" />
                    <span>Claude Opus 4.7 is responding...</span>
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-t from-[#0f0f0f] via-[#0f0f0f] to-[#0f0f0f]/80 px-4 pb-4 md:px-8 md:pb-6">
                <div className="mx-auto max-w-3xl">
                  <div className="rounded-[24px] border border-white/[0.10] bg-[#2b2b2b] p-2">
                    <div className="flex items-end gap-2">
                      <button className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400">
                        <Paperclip className="h-4 w-4" />
                      </button>
                      <input
                        type="text"
                        placeholder="Ask anything..."
                        disabled
                        className="min-h-9 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-gray-500"
                      />
                      <button className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white">
                        <Send className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pl-1">
                      <div className="flex items-center gap-1.5 text-xs text-gray-500">
                        <ImageIcon className="h-3.5 w-3.5" />
                        Files, images, and PDFs supported
                      </div>
                      <div className="flex rounded-lg border border-white/[0.06] bg-black/10 p-0.5">
                        {modes.map((mode) => (
                          <span
                            key={mode}
                            className={`rounded-md px-2 py-1 text-[11px] ${
                              mode === 'Instant'
                                ? 'border border-violet-400/20 bg-violet-500/10 text-violet-200'
                                : 'text-gray-500'
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
            </main>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
