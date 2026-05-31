'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Infinity, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/components/ui/use-toast'
import { formatDate, formatCredits } from '@/lib/utils'
import { CreateUserDialog } from './create-user-dialog'

interface AdminUser {
  id: string
  user_id: string
  email: string
  display_name: string
  role: 'user' | 'sub_admin' | 'admin'
  credits: number
  unlimited_credits: boolean
  subscription_tier: 'free' | 'pro' | 'unlimited'
  account_status: 'active' | 'expired' | 'disabled'
  account_expires_at: string | null
  owner_sub_admin_id: string | null
  created_at: string
  message_count: number
  conversation_count: number
}

interface AdminResponse {
  actorRole: 'admin' | 'sub_admin'
  users: AdminUser[]
  subAdmins: Array<{ user_id: string; display_name: string; email: string }>
}

export function AdminUserTable() {
  const [data, setData] = useState<AdminResponse>({ actorRole: 'sub_admin', users: [], subAdmins: [] })
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ unassigned: true })
  const [editForm, setEditForm] = useState({
    role: 'user',
    credits: '0',
    unlimitedCredits: false,
    accountExpiresAt: '',
    accountStatus: 'active',
    ownerSubAdminId: 'unassigned',
  })

  const loadUsers = useCallback(async () => {
    const response = await fetch('/api/admin/users')
    const result = await response.json()
    if (!response.ok) {
      toast({ title: 'Failed to load users', description: result.error, variant: 'destructive' })
      return
    }
    setData(result)
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  const groups = useMemo(() => {
    const users = data.users.filter((user) => user.role === 'user')
    return [
      { id: 'unassigned', label: 'Main admin / unassigned', users: users.filter((user) => !user.owner_sub_admin_id) },
      ...data.subAdmins.map((subAdmin) => ({
        id: subAdmin.user_id,
        label: subAdmin.display_name,
        users: users.filter((user) => user.owner_sub_admin_id === subAdmin.user_id),
      })),
    ]
  }, [data])

  const openEdit = (user: AdminUser) => {
    setSelectedUser(user)
    setEditForm({
      role: user.role,
      credits: String(user.credits),
      unlimitedCredits: user.unlimited_credits,
      accountExpiresAt: user.account_expires_at?.slice(0, 10) || '',
      accountStatus: user.account_status === 'disabled' ? 'disabled' : 'active',
      ownerSubAdminId: user.owner_sub_admin_id || 'unassigned',
    })
    setEditOpen(true)
  }

  const saveUser = async () => {
    if (!selectedUser) return
    const response = await fetch(`/api/admin/users/${selectedUser.user_id}/update`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...editForm,
        credits: Number(editForm.credits) || 0,
        ownerSubAdminId: editForm.ownerSubAdminId === 'unassigned' ? null : editForm.ownerSubAdminId,
      }),
    })
    const result = await response.json()
    if (!response.ok) {
      toast({ title: 'Update failed', description: result.error, variant: 'destructive' })
      return
    }
    toast({ title: 'Account updated' })
    setEditOpen(false)
    await loadUsers()
  }

  const renderUser = (user: AdminUser) => (
    <tr key={user.id} className="border-b border-white/[0.05] text-sm hover:bg-white/[0.025]">
      <td className="px-3 py-3 text-gray-200">{user.display_name}</td>
      <td className="px-3 py-3 text-gray-400">{user.email}</td>
      <td className="px-3 py-3 text-gray-400">{user.role.replace('_', '-')}</td>
      <td className="px-3 py-3 text-gray-200">{user.unlimited_credits ? <span className="flex items-center gap-1 text-violet-300"><Infinity className="h-4 w-4" />Unlimited</span> : formatCredits(user.credits)}</td>
      <td className="px-3 py-3 text-gray-400">{user.message_count}</td>
      <td className="px-3 py-3 text-gray-400">{user.conversation_count}</td>
      <td className="px-3 py-3"><Status value={user.account_status} /></td>
      <td className="px-3 py-3 text-gray-500">{user.account_expires_at ? formatDate(user.account_expires_at) : 'No expiry'}</td>
      <td className="px-3 py-3"><Button size="sm" variant="outline" className="border-white/[0.10]" onClick={() => openEdit(user)}><Settings className="mr-1 h-3 w-3" />Edit</Button></td>
    </tr>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">Visible accounts: <span className="text-gray-200">{data.users.length}</span></p>
        <CreateUserDialog actorRole={data.actorRole} subAdmins={data.subAdmins} onUserCreated={loadUsers} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/[0.07]">
        <table className="w-full min-w-[980px]">
          <thead className="bg-white/[0.025] text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>{['Name', 'Email', 'Role', 'Credits', 'Messages', 'Chats', 'Status', 'Expiry', 'Actions'].map((label) => <th key={label} className="px-3 py-3 font-medium">{label}</th>)}</tr>
          </thead>
          <tbody>
            {data.actorRole === 'admin' && data.users.filter((user) => user.role !== 'user').map(renderUser)}
            {data.actorRole === 'admin' ? groups.map((group) => (
              <Fragment key={group.id}>
                <tr className="border-b border-white/[0.05] bg-white/[0.015]">
                  <td colSpan={9}>
                    <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-300" onClick={() => setExpandedGroups({ ...expandedGroups, [group.id]: !expandedGroups[group.id] })}>
                      {expandedGroups[group.id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      {group.label} <span className="text-xs text-gray-600">({group.users.length})</span>
                    </button>
                  </td>
                </tr>
                {expandedGroups[group.id] && group.users.map(renderUser)}
              </Fragment>
            )) : data.users.map(renderUser)}
          </tbody>
        </table>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="border-white/[0.08] bg-[#181818]">
          <DialogHeader>
            <DialogTitle>Edit account</DialogTitle>
            <DialogDescription className="text-gray-400">{selectedUser?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {data.actorRole === 'admin' && <Field label="Role"><Select value={editForm.role} onValueChange={(role) => setEditForm({ ...editForm, role })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent className="bg-[#202020]"><SelectItem value="user">User</SelectItem><SelectItem value="sub_admin">Sub-admin</SelectItem><SelectItem value="admin">Main admin</SelectItem></SelectContent></Select></Field>}
            {data.actorRole === 'admin' && editForm.role === 'user' && <Field label="Assigned panel"><Select value={editForm.ownerSubAdminId} onValueChange={(ownerSubAdminId) => setEditForm({ ...editForm, ownerSubAdminId })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent className="bg-[#202020]"><SelectItem value="unassigned">Main admin / unassigned</SelectItem>{data.subAdmins.map((subAdmin) => <SelectItem key={subAdmin.user_id} value={subAdmin.user_id}>{subAdmin.display_name}</SelectItem>)}</SelectContent></Select></Field>}
            <Field label="Finite credits"><Input type="number" min="0" disabled={editForm.unlimitedCredits} value={editForm.credits} onChange={(event) => setEditForm({ ...editForm, credits: event.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editForm.unlimitedCredits} onChange={(event) => setEditForm({ ...editForm, unlimitedCredits: event.target.checked })} />Unlimited credits</label>
            <Field label="Expiry date"><Input type="date" value={editForm.accountExpiresAt} onChange={(event) => setEditForm({ ...editForm, accountExpiresAt: event.target.value })} /></Field>
            <Field label="Account status"><Select value={editForm.accountStatus} onValueChange={(accountStatus) => setEditForm({ ...editForm, accountStatus })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent className="bg-[#202020]"><SelectItem value="active">Active</SelectItem><SelectItem value="disabled">Disabled</SelectItem></SelectContent></Select></Field>
            <Button onClick={saveUser} className="w-full bg-violet-600 hover:bg-violet-500">Save changes</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>
}

function Status({ value }: { value: AdminUser['account_status'] }) {
  const color = value === 'active' ? 'text-emerald-300 bg-emerald-500/10' : value === 'expired' ? 'text-amber-300 bg-amber-500/10' : 'text-red-300 bg-red-500/10'
  return <span className={`rounded-full px-2 py-1 text-xs ${color}`}>{value}</span>
}
