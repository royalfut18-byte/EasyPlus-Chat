'use client'

import { useState } from 'react'
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
import { UserPlus, Loader2 } from 'lucide-react'

interface CreateUserDialogProps {
  onUserCreated: () => void
}

export function CreateUserDialog({ onUserCreated }: CreateUserDialogProps) {
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    displayName: '',
    role: 'user',
    credits: '1000',
    unlimitedCredits: false,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const response = await fetch('/api/admin/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          displayName: formData.displayName,
          role: formData.role,
          credits: parseInt(formData.credits) || 1000,
          unlimitedCredits: formData.unlimitedCredits,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create user')
      }

      toast({
        title: 'Success',
        description: 'User account created successfully',
      })

      // Reset form
      setFormData({
        email: '',
        password: '',
        displayName: '',
        role: 'user',
        credits: '1000',
        unlimitedCredits: false,
      })

      setOpen(false)
      onUserCreated()
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gradient-primary">
          <UserPlus className="mr-2 h-4 w-4" />
          Create User
        </Button>
      </DialogTrigger>
      <DialogContent className="glass-strong border-white/10 max-w-md">
        <DialogHeader>
          <DialogTitle>Create New User Account</DialogTitle>
          <DialogDescription className="text-gray-400">
            Create a new user account with custom settings
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="user@example.com"
              className="glass"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password *</Label>
            <Input
              id="password"
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              placeholder="Minimum 6 characters"
              className="glass"
              required
              minLength={6}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              type="text"
              value={formData.displayName}
              onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              placeholder="Optional, defaults to email"
              className="glass"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <Select
              value={formData.role}
              onValueChange={(value) => setFormData({ ...formData, role: value })}
            >
              <SelectTrigger className="glass">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="glass-strong border-white/10">
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="credits">Initial Credits</Label>
            <Input
              id="credits"
              type="number"
              value={formData.credits}
              onChange={(e) => setFormData({ ...formData, credits: e.target.value })}
              placeholder="1000"
              className="glass"
              min="0"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="unlimitedCredits"
              type="checkbox"
              checked={formData.unlimitedCredits}
              onChange={(e) =>
                setFormData({ ...formData, unlimitedCredits: e.target.checked })
              }
              className="w-4 h-4 rounded border-white/20 bg-white/10 text-primary focus:ring-primary"
            />
            <Label htmlFor="unlimitedCredits" className="cursor-pointer">
              Unlimited Credits
            </Label>
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              className="flex-1"
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1 gradient-primary"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create User'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
