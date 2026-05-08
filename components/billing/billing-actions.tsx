'use client'

import { Button } from '@/components/ui/button'
import { ExternalLink } from 'lucide-react'
import { toast } from '@/components/ui/use-toast'

export function BillingActions() {
  const handleManageBilling = async () => {
    try {
      const response = await fetch('/api/billing/portal')
      const { url } = await response.json()
      if (url) {
        window.location.href = url
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to open billing portal',
        variant: 'destructive',
      })
    }
  }

  return (
    <Button onClick={handleManageBilling} variant="outline">
      <ExternalLink className="mr-2 h-4 w-4" />
      Manage Billing Portal
    </Button>
  )
}
