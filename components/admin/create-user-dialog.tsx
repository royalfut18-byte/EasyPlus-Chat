'use client'

import { useState } from 'react'
import { Loader2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/components/ui/use-toast'

interface SubAdminOption {
  user_id: string
  display_name: string
}

interface CreateUserDialogProps {
  actorRole: 'admin' | 'sub_admin'
  subAdmins: SubAdminOption[]
  onUserCreated: () => void
}

const INITIAL_FORM = {
  email: '',
  password: '',
  displayName: '',
  role: 'user',
  unlimitedCredits: false,
  accountExpiresAt: '',
  ownerSubAdminId: 'unassigned',
}

export function CreateUserDialog({ actorRole, subAdmins, onUserCreated }: CreateUserDialogProps) {
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState(INITIAL_FORM)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (isLoading) return
    setIsLoading(true)

    try {
      const response = await fetch('/api/admin/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          ownerSubAdminId: formData.ownerSubAdminId === 'unassigned' ? null : formData.ownerSubAdminId,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || `Server error (${response.status})`)

      toast({ title: 'Account created', description: result.email })
      setFormData(INITIAL_FORM)
      setOpen(false)
      onUserCreated()
    } catch (error: any) {
      toast({ title: 'Failed to create account', description: error.message, variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-violet-600 text-white hover:bg-violet-500">
          <UserPlus className="mr-2 h-4 w-4" />
          Create account
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md border-white/[0.08] bg-[#181818]">
        <DialogHeader>
          <DialogTitle>Create account</DialogTitle>
          <DialogDescription className="text-gray-400">Set entitlement and optional expiration at creation.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Email"><Input type="email" required value={formData.email} onChange={(event) => setFormData({ ...formData, email: event.target.value })} /></Field>
          <Field label="Password"><Input type="password" required minLength={6} value={formData.password} onChange={(event) => setFormData({ ...formData, password: event.target.value })} /></Field>
          <Field label="Display name"><Input value={formData.displayName} onChange={(event) => setFormData({ ...formData, displayName: event.target.value })} /></Field>

          {actorRole === 'admin' && (
            <Field label="Role">
              <Select value={formData.role} onValueChange={(role) => setFormData({ ...formData, role, ownerSubAdminId: role === 'user' ? formData.ownerSubAdminId : 'unassigned' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="border-white/[0.08] bg-[#202020]">
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="sub_admin">Sub-admin</SelectItem>
                  <SelectItem value="admin">Main admin</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}

          {actorRole === 'admin' && formData.role === 'user' && (
            <Field label="Assigned panel">
              <Select value={formData.ownerSubAdminId} onValueChange={(ownerSubAdminId) => setFormData({ ...formData, ownerSubAdminId })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="border-white/[0.08] bg-[#202020]">
                  <SelectItem value="unassigned">Main admin / unassigned</SelectItem>
                  {subAdmins.map((subAdmin) => <SelectItem key={subAdmin.user_id} value={subAdmin.user_id}>{subAdmin.display_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}

          <Field label="Expiry date">
            <Input type="date" value={formData.accountExpiresAt} onChange={(event) => setFormData({ ...formData, accountExpiresAt: event.target.value })} />
          </Field>

          <label className="flex items-center gap-2 text-sm text-gray-200">
            <input type="checkbox" checked={formData.unlimitedCredits} onChange={(event) => setFormData({ ...formData, unlimitedCredits: event.target.checked })} />
            Unlimited credits
          </label>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1 border-white/[0.10]" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" className="flex-1 bg-violet-600 text-white hover:bg-violet-500" disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>
}
