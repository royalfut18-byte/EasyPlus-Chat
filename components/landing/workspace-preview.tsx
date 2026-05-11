'use client'

import { motion } from 'framer-motion'
import { MessageSquare, Search, Box, Send, Globe, Sparkles } from 'lucide-react'
import { ChatGPTIcon } from '@/components/icons/chatgpt-icon'
import { AnthropicIcon } from '@/components/icons/anthropic-icon'

export function WorkspacePreview() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8 }}
      className="max-w-7xl mx-auto mb-20 md:mb-40 px-4"
    >
      <div className="text-center mb-12 md:mb-16 space-y-3 md:space-y-4">
        <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold">See the workspace in action.</h2>
        <p className="text-base md:text-lg lg:text-xl text-gray-400 max-w-3xl mx-auto">
          Search the web, switch models, create artifacts, upload images, and keep conversations organized — all from one private chat interface.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="relative"
      >
        {/* Glow effect */}
        <div className="absolute -inset-4 bg-gradient-to-r from-purple-500/20 via-blue-500/20 to-cyan-500/20 rounded-3xl blur-3xl" />

        {/* Browser chrome */}
        <div className="relative glass-strong rounded-2xl border-2 border-white/10 overflow-hidden shadow-2xl">
          {/* Window header */}
          <div className="bg-gradient-to-r from-white/10 to-white/5 p-3 md:p-4 border-b border-white/10 flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/50" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
              <div className="w-3 h-3 rounded-full bg-green-500/50" />
            </div>
            <div className="flex-1 text-center">
              <span className="text-xs md:text-sm text-gray-400">EasyPlus AI Workspace</span>
            </div>
          </div>

          {/* Workspace content */}
          <div className="flex h-[500px] md:h-[600px]">
            {/* Sidebar */}
            <div className="hidden md:block w-64 border-r border-white/10 bg-[#07070d] p-4 space-y-3">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Conversations</h3>
                <MessageSquare className="h-4 w-4 text-gray-400" />
              </div>
              {[
                { title: 'Latest AI News', active: true },
                { title: 'Code Review Help', active: false },
                { title: 'Research Summary', active: false },
                { title: 'Web Search Test', active: false },
              ].map((conv, i) => (
                <div
                  key={i}
                  className={`p-3 rounded-xl transition-all ${
                    conv.active
                      ? 'bg-gradient-to-r from-purple-500/20 to-blue-500/20 border border-purple-500/30'
                      : 'bg-white/5 border border-transparent hover:border-white/10'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <MessageSquare className={`h-4 w-4 mt-0.5 ${conv.active ? 'text-purple-400' : 'text-gray-400'}`} />
                    <span className={`text-xs font-medium ${conv.active ? 'text-white' : 'text-gray-300'}`}>
                      {conv.title}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Main chat area */}
            <div className="flex-1 flex flex-col bg-[#0A0A0F]">
              {/* Model selector bar */}
              <div className="border-b border-white/10 p-3 md:p-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {[
                    { name: 'Claude Opus 4.6', icon: <AnthropicIcon className="h-4 w-4" />, color: '#d97757', active: true },
                    { name: 'ChatGPT 5.5', icon: <ChatGPTIcon className="h-4 w-4" />, color: '#10a37f', active: false },
                    { name: 'Gemini 3.1', icon: <Sparkles className="h-4 w-4" />, color: '#4285f4', active: false },
                  ].map((model, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                        model.active
                          ? 'border-transparent shadow-lg'
                          : 'border-white/10 bg-white/5'
                      }`}
                      style={model.active ? {
                        background: `linear-gradient(135deg, ${model.color}40, ${model.color}20)`,
                        boxShadow: `0 0 15px ${model.color}40`,
                      } : undefined}
                    >
                      <div className="w-5 h-5 rounded-lg bg-white/10 flex items-center justify-center" style={{ color: model.color }}>
                        {model.icon}
                      </div>
                      <span className={model.active ? 'text-white' : 'text-gray-400'}>{model.name}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-medium">
                    <Globe className="h-3 w-3" />
                    <span>Web Search</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-400 text-xs font-medium">
                    <Box className="h-3 w-3" />
                    <span>Artifacts</span>
                  </div>
                </div>
              </div>

              {/* Chat messages */}
              <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
                {/* User message */}
                <div className="flex justify-end">
                  <div className="max-w-[80%] md:max-w-[70%] rounded-[22px] bg-gradient-to-br from-purple-600/90 to-blue-600/90 backdrop-blur-sm text-white shadow-lg p-3 md:p-4">
                    <p className="text-xs md:text-sm leading-relaxed">
                      What's the latest news about AI today? Search the web.
                    </p>
                  </div>
                </div>

                {/* Assistant message */}
                <div className="flex justify-start">
                  <div className="max-w-[85%] md:max-w-[80%] glass rounded-2xl p-4 md:p-5 space-y-3">
                    <div className="flex items-center gap-2 pb-2 border-b border-white/10">
                      <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-[#d97757]/20 to-[#d97757]/10 flex items-center justify-center">
                        <AnthropicIcon className="w-3.5 h-3.5 text-[#d97757]" />
                      </div>
                      <span className="text-xs font-medium text-gray-400">Claude Opus 4.6</span>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-cyan-400">
                        <Search className="h-4 w-4 animate-pulse" />
                        <span className="text-xs font-medium">Searching the web...</span>
                      </div>

                      <div className="text-xs md:text-sm text-gray-100 leading-relaxed space-y-2">
                        <p>Based on recent web search results, here are today's key AI developments:</p>
                        <ul className="space-y-1 pl-4">
                          <li className="flex items-start gap-2">
                            <span className="text-purple-400 mt-1">•</span>
                            <span>OpenAI releases new safety research framework</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <span className="text-purple-400 mt-1">•</span>
                            <span>Claude 4.6 advances in reasoning capabilities</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <span className="text-purple-400 mt-1">•</span>
                            <span>DeepMind achieves breakthrough in protein folding</span>
                          </li>
                        </ul>
                      </div>

                      {/* Source chips */}
                      <div className="flex flex-wrap gap-2 pt-2">
                        {['TechCrunch', 'The Verge', 'MIT Tech'].map((source, i) => (
                          <div key={i} className="px-2 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-[10px] md:text-xs font-medium">
                            {source}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Typing indicator */}
                <div className="flex items-center gap-2 text-gray-400">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-xs">Claude is responding...</span>
                </div>
              </div>

              {/* Chat input */}
              <div className="border-t border-white/10 bg-[#0A0A0F]/90 backdrop-blur-sm p-3 md:p-4">
                <div className="glass-strong rounded-xl p-2.5 md:p-3 flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Ask anything..."
                    disabled
                    className="flex-1 bg-transparent text-xs md:text-sm text-white placeholder:text-gray-400 outline-none"
                  />
                  <div className="h-9 w-9 md:h-10 md:w-10 rounded-xl gradient-primary flex items-center justify-center">
                    <Send className="h-4 w-4 text-white" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
