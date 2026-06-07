'use client'

import { motion } from 'framer-motion'
import {
  Brain,
  Code2,
  FileText,
  FolderKanban,
  Globe2,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Send,
  Sparkles,
  Upload,
} from 'lucide-react'
import { Logo } from '@/components/brand/logo'
import { UI_MODELS } from '@/types/models'

const chats = [
  { title: 'Research synthesis', date: 'Today', active: true },
  { title: 'Website artifact', date: 'Today', active: false },
  { title: 'Essay feedback', date: 'Yesterday', active: false },
]

const projects = ['HSC Economics', 'Client Website', 'Startup Research']

const previewModels = UI_MODELS.map((model) => ({
  id: model.id,
  name: model.name,
  color: model.color,
}))

export function WorkspacePreview() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 34 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: 0.32 }}
      className="relative mx-auto mt-16 max-w-7xl md:mt-20"
    >
      <div className="absolute -inset-x-8 -inset-y-6 rounded-[2.5rem] bg-[linear-gradient(110deg,rgba(139,92,246,0.14),rgba(255,255,255,0.04),rgba(34,211,238,0.10))] blur-3xl" />
      <div className="relative overflow-hidden rounded-[1.75rem] border border-white/[0.10] bg-[#0c0c10] shadow-2xl shadow-black/50 md:rounded-[2rem]">
        <div className="flex items-center justify-between border-b border-white/[0.07] bg-white/[0.035] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-red-400/50" />
            <span className="h-3 w-3 rounded-full bg-yellow-400/50" />
            <span className="h-3 w-3 rounded-full bg-emerald-400/50" />
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Logo size="sm" />
            <span className="hidden sm:inline">EasyPlus AI Workspace</span>
          </div>
          <div className="hidden rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200 sm:block">
            Workspace ready
          </div>
        </div>

        <div className="grid min-h-[660px] lg:grid-cols-[280px_1fr_340px]">
          <aside className="hidden border-r border-white/[0.07] bg-[#111115] p-4 lg:block">
            <button className="flex h-10 w-full items-center justify-center rounded-xl bg-white text-sm font-semibold text-black">
              <Plus className="h-4 w-4" />
              New chat
            </button>

            <div className="mt-6">
              <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-600">Projects</p>
              <div className="mt-3 space-y-1">
                {projects.map((project, index) => (
                  <div key={project} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${index === 0 ? 'bg-violet-500/12 text-violet-100' : 'text-gray-400'}`}>
                    <FolderKanban className="h-4 w-4" />
                    {project}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-7">
              <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-600">Recent chats</p>
              <div className="mt-3 space-y-1">
                {chats.map((chat) => (
                  <div key={chat.title} className={`rounded-xl px-3 py-2 ${chat.active ? 'bg-white/[0.07]' : ''}`}>
                    <div className="flex items-start gap-2">
                      <MessageSquare className={`mt-0.5 h-4 w-4 ${chat.active ? 'text-violet-300' : 'text-gray-600'}`} />
                      <div className="min-w-0">
                        <p className={`truncate text-sm ${chat.active ? 'text-white' : 'text-gray-400'}`}>{chat.title}</p>
                        <p className="mt-0.5 text-xs text-gray-600">{chat.date}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-7 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Brain className="h-4 w-4 text-violet-300" />
                Project memory
              </div>
              <p className="mt-3 text-xs leading-5 text-gray-500">Remembers writing style, uploaded context, and project instructions.</p>
            </div>
          </aside>

          <section className="flex min-w-0 flex-col bg-[#0b0b0e]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-3 md:px-6">
              <div>
                <p className="text-xs text-gray-600">Project</p>
                <h3 className="text-sm font-semibold text-white md:text-base">HSC Economics</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {previewModels.map((model, index) => (
                  <span
                    key={model.id}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      index === 1
                        ? 'border-white/[0.14] bg-white/[0.08] text-white'
                        : 'border-white/[0.08] bg-white/[0.03] text-gray-400'
                    }`}
                  >
                    <span className="mr-2 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: model.color }} />
                    {model.name}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {['Fast chat', 'Research', 'Artifacts'].map((item, index) => (
                  <span key={item} className={`rounded-full border px-3 py-1 text-xs ${index === 0 ? 'border-violet-300/20 bg-violet-500/10 text-violet-100' : 'border-white/[0.08] bg-white/[0.03] text-gray-400'}`}>
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex-1 space-y-6 overflow-hidden px-4 py-6 md:px-8">
              <div className="mb-4 ml-auto max-w-[85%] rounded-2xl border border-violet-300/[0.08] bg-[#312b3b] px-3 py-2.5 text-gray-100 md:max-w-[72%] md:px-3.5 md:py-3">
                <p className="mb-0 whitespace-pre-wrap break-words text-sm leading-6 md:text-base">
                  Use my economics project context and explain the latest inflation data in essay form.
                </p>
              </div>

              <div className="max-w-3xl">
                <div className="mb-3 flex items-center gap-2 text-xs text-gray-500">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.06] text-violet-200">
                    <Sparkles className="h-4 w-4" />
                  </span>
                  AI response
                </div>
                <div className="space-y-4 rounded-[1.4rem] border border-white/[0.07] bg-white/[0.035] p-5 text-sm leading-7 text-gray-300">
                  <p>
                    Using your project memory, I will structure this with a clear thesis, Australian examples, and a judgement in each body paragraph.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Insight icon={<Search className="h-4 w-4" />} label="Research" value="Current context" />
                    <Insight icon={<FileText className="h-4 w-4" />} label="Files" value="3 attached" />
                    <Insight icon={<Brain className="h-4 w-4" />} label="Memory" value="Band 6 style" />
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-white">
                    <Upload className="h-4 w-4 text-violet-300" />
                    File upload
                  </div>
                  <div className="mt-3 rounded-xl border border-white/[0.07] bg-black/20 p-3 text-xs text-gray-400">
                    stimulus.pdf uploaded and ready for analysis
                  </div>
                </div>
                <div className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-white">
                    <Globe2 className="h-4 w-4 text-cyan-300" />
                    Search tools
                  </div>
                  <div className="mt-3 rounded-xl border border-white/[0.07] bg-black/20 p-3 text-xs text-gray-400">
                    Recent information can be researched when needed
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-white/[0.07] bg-[#0b0b0e] p-4 md:p-6">
              <div className="rounded-[1.5rem] border border-white/[0.10] bg-[#1c1c22] p-2">
                <div className="flex items-end gap-2">
                  <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-400" aria-label="Attach file">
                    <Paperclip className="h-4 w-4" />
                  </button>
                  <input disabled placeholder="Ask anything about this project..." className="min-h-10 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-gray-500" />
                  <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-500 text-white" aria-label="Send message">
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </section>

          <aside className="hidden border-l border-white/[0.07] bg-[#111115] p-4 xl:block">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Artifact</h3>
              <div className="rounded-full border border-white/[0.08] px-2 py-1 text-[11px] text-gray-500">Preview</div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/[0.07] bg-black/20 p-3">
              <div className="flex rounded-full border border-white/[0.08] bg-white/[0.03] p-1 text-xs">
                <span className="rounded-full bg-violet-500 px-3 py-1 text-white">Preview</span>
                <span className="px-3 py-1 text-gray-500">Code</span>
              </div>
              <div className="mt-4 rounded-2xl bg-gradient-to-br from-violet-500/20 via-white/[0.05] to-cyan-500/10 p-4">
                <div className="rounded-xl border border-white/[0.10] bg-black/30 p-4">
                  <Code2 className="h-5 w-5 text-violet-200" />
                  <p className="mt-3 text-sm font-semibold text-white">Essay planner</p>
                  <p className="mt-2 text-xs leading-5 text-gray-500">Generated component with sections, examples, and evaluation prompts.</p>
                  <div className="mt-4 space-y-2">
                    <div className="h-2 rounded-full bg-white/[0.14]" />
                    <div className="h-2 w-4/5 rounded-full bg-white/[0.10]" />
                    <div className="h-2 w-2/3 rounded-full bg-violet-300/30" />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-4">
              <p className="text-sm font-medium text-white">Project instructions</p>
              <p className="mt-2 text-xs leading-5 text-gray-500">Use concise explanations, Australian examples, and clear judgement.</p>
            </div>
          </aside>
        </div>
      </div>
    </motion.div>
  )
}

function Insight({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-3">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span className="text-violet-300">{icon}</span>
        {label}
      </div>
      <p className="mt-2 text-sm font-medium text-gray-200">{value}</p>
    </div>
  )
}
