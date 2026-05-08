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
import { toast } from '@/components/ui/use-toast'
import { formatDate, formatCredits } from '@/lib/utils'

export function AdminUserTable() {
  const [users, setUsers] = useState<any[]>([])
  const [selectedUser, setSelectedUser] = useState<any>(null)
  const [creditAmount, setCreditAmount] = useState('')
  const [reason, setReason] = useState('')

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

  const handleAdjustCredits = async () => {
    if (!selectedUser || !creditAmount) return

    const response = await fetch(`/api/admin/users/${selectedUser.id}/credits`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: parseInt(creditAmount),
        reason: reason || 'Manual adjustment by admin',
      }),
    })

    if (response.ok) {
      toast({
        title: 'Success',
        description: 'Credits adjusted successfully',
      })
      setCreditAmount('')
      setReason('')
      setSelectedUser(null)
      loadUsers()
    } else {
      toast({
        title: 'Error',
        description: 'Failed to adjust credits',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10 text-left">
              <th className="pb-2 text-sm font-medium text-gray-400">User</th>
              <th className="pb-2 text-sm font-medium text-gray-400">Email</th>
              <th className="pb-2 text-sm font-medium text-gray-400">Credits</th>
              <th className="pb-2 text-sm font-medium text-gray-400">Tier</th>
              <th className="pb-2 text-sm font-medium text-gray-400">Role</th>
              <th className="pb-2 text-sm font-medium text-gray-400">Joined</th>
              <th className="pb-2 text-sm font-medium text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-white/5">
                <td className="py-3 text-sm text-white">{user.display_name || 'N/A'}</td>
                <td className="py-3 text-sm text-gray-400">{user.user_id}</td>
                <td className="py-3 text-sm text-white">{formatCredits(user.credits)}</td>
                <td className="py-3 text-sm text-gray-400 capitalize">
                  {user.subscription_tier}
                </td>
                <td className="py-3 text-sm text-gray-400 capitalize">{user.role}</td>
                <td className="py-3 text-sm text-gray-400">
                  {formatDate(user.created_at)}
                </td>
                <td className="py-3">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedUser(user)}
                      >
                        Adjust Credits
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="glass-strong border-white/10">
                      <DialogHeader>
                        <DialogTitle>Adjust Credits</DialogTitle>
                        <DialogDescription className="text-gray-400">
                          Modify credits for {user.display_name}
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label>Current Balance</Label>
                          <p className="text-2xl font-bold gradient-text">
                            {formatCredits(user.credits)}
                          </p>
                        </div>
                        <div>
                          <Label htmlFor="amount">Amount (positive to add, negative to deduct)</Label>
                          <Input
                            id="amount"
                            type="number"
                            value={creditAmount}
                            onChange={(e) => setCreditAmount(e.target.value)}
                            placeholder="e.g., 1000 or -500"
                            className="glass"
                          />
                        </div>
                        <div>
                          <Label htmlFor="reason">Reason</Label>
                          <Input
                            id="reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Optional reason"
                            className="glass"
                          />
                        </div>
                        <Button
                          onClick={handleAdjustCredits}
                          className="w-full gradient-primary"
                        >
                          Apply Adjustment
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
