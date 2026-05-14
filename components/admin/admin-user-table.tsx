'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/use-toast'
import { formatDate, formatCredits } from '@/lib/utils'
import { Settings, Infinity } from 'lucide-react'
import { CreateUserDialog } from './create-user-dialog'

export function AdminUserTable() {
  const [users, setUsers] = useState<any[]>([])
  const [selectedUser, setSelectedUser] = useState<any>(null)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editForm, setEditForm] = useState({
    role: 'user',
    credits: '',
    unlimitedCredits: false,
  })

  useEffect(() => {
    loadUsers()
  }, [])

  const loadUsers = async () => {
    const response = await fetch('/api/admin/users')
    if (response.ok) {
      const data = await response.json()
      setUsers(data)
    }
  }

  const openEditDialog = (user: any) => {
    setSelectedUser(user)
    setEditForm({
      role: user.role || 'user',
      credits: user.credits?.toString() || '0',
      unlimitedCredits: user.unlimited_credits || false,
    })
    setEditDialogOpen(true)
  }

  const handleUpdateUser = async () => {
    if (!selectedUser) return

    try {
      const response = await fetch(`/api/admin/users/${selectedUser.user_id}/update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: editForm.role,
          credits: parseInt(editForm.credits) || 0,
          unlimitedCredits: editForm.unlimitedCredits,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to update user')
      }

      toast({
        title: 'Success',
        description: 'User updated successfully',
      })

      setEditDialogOpen(false)
      setSelectedUser(null)
      loadUsers()
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-400">
          Total users: <span className="text-white font-semibold">{users.length}</span>
        </p>
        <CreateUserDialog onUserCreated={loadUsers} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10 text-left">
              <th className="pb-3 text-sm font-medium text-gray-400">Name</th>
              <th className="pb-3 text-sm font-medium text-gray-400">Email</th>
              <th className="pb-3 text-sm font-medium text-gray-400">Role</th>
              <th className="pb-3 text-sm font-medium text-gray-400">Credits</th>
              <th className="pb-3 text-sm font-medium text-gray-400">Messages</th>
              <th className="pb-3 text-sm font-medium text-gray-400">Chats</th>
              <th className="pb-3 text-sm font-medium text-gray-400">Status</th>
              <th className="pb-3 text-sm font-medium text-gray-400">Joined</th>
              <th className="pb-3 text-sm font-medium text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td className="py-3 text-sm text-white">{user.display_name || 'N/A'}</td>
                <td className="py-3 text-sm text-gray-400">{user.email}</td>
                <td className="py-3">
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      user.role === 'admin'
                        ? 'bg-violet-500/15 text-violet-300'
                        : 'bg-blue-500/20 text-blue-300'
                    }`}
                  >
                    {user.role}
                  </span>
                </td>
                <td className="py-3 text-sm">
                  {user.unlimited_credits || user.role === 'admin' ? (
                    <div className="flex items-center gap-1 text-yellow-400">
                      <Infinity className="h-4 w-4" />
                      <span className="font-semibold">Unlimited</span>
                    </div>
                  ) : (
                    <span className="text-white">{formatCredits(user.credits)}</span>
                  )}
                </td>
                <td className="py-3 text-sm text-white">
                  {user.message_count || 0}
                </td>
                <td className="py-3 text-sm text-white">
                  {user.conversation_count || 0}
                </td>
                <td className="py-3">
                  <span className="text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-300">
                    Active
                  </span>
                </td>
                <td className="py-3 text-sm text-gray-400">
                  {formatDate(user.created_at)}
                </td>
                <td className="py-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openEditDialog(user)}
                    className="text-xs"
                  >
                    <Settings className="h-3 w-3 mr-1" />
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="bg-[#111018] border-white/[0.08]">
          <DialogHeader>
            <DialogTitle>Edit User Settings</DialogTitle>
            <DialogDescription className="text-gray-400">
              Update settings for {selectedUser?.display_name || selectedUser?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select
                value={editForm.role}
                onValueChange={(value) => setEditForm({ ...editForm, role: value })}
              >
                <SelectTrigger className="glass">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#111018] border-white/[0.08]">
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="credits">Credits</Label>
              <Input
                id="credits"
                type="number"
                value={editForm.credits}
                onChange={(e) => setEditForm({ ...editForm, credits: e.target.value })}
                className="glass"
                disabled={editForm.unlimitedCredits}
              />
              <p className="text-xs text-gray-500">
                Current: {formatCredits(selectedUser?.credits || 0)}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="unlimitedCredits"
                type="checkbox"
                checked={editForm.unlimitedCredits}
                onChange={(e) =>
                  setEditForm({ ...editForm, unlimitedCredits: e.target.checked })
                }
                className="w-4 h-4 rounded border-white/20 bg-white/10 text-primary focus:ring-primary"
              />
              <Label htmlFor="unlimitedCredits" className="cursor-pointer flex items-center gap-1">
                <Infinity className="h-4 w-4 text-yellow-400" />
                Unlimited Credits
              </Label>
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={() => setEditDialogOpen(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button onClick={handleUpdateUser} className="flex-1 bg-violet-600/80 hover:bg-violet-600 text-white">
                Save Changes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
