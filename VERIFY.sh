#!/bin/bash
echo "🔍 Easy Plus AI - Project Verification"
echo "======================================"
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

check_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✓${NC} $1"
        return 0
    else
        echo -e "${RED}✗${NC} $1 - MISSING"
        return 1
    fi
}

missing=0

echo "📦 Configuration Files:"
check_file "package.json" || ((missing++))
check_file ".env.example" || ((missing++))
check_file "tsconfig.json" || ((missing++))
check_file "tailwind.config.ts" || ((missing++))
check_file "next.config.ts" || ((missing++))
check_file "middleware.ts" || ((missing++))
echo ""

echo "📚 Documentation:"
check_file "README.md" || ((missing++))
check_file "QUICKSTART.md" || ((missing++))
check_file "DEPLOYMENT.md" || ((missing++))
check_file "CHECKLIST.md" || ((missing++))
echo ""

echo "🎨 Core App Files:"
check_file "app/layout.tsx" || ((missing++))
check_file "app/page.tsx" || ((missing++))
check_file "app/globals.css" || ((missing++))
echo ""

echo "🔐 Auth Pages:"
check_file "app/(auth)/login/page.tsx" || ((missing++))
check_file "app/(auth)/signup/page.tsx" || ((missing++))
check_file "app/auth/callback/route.ts" || ((missing++))
echo ""

echo "💬 Chat System:"
check_file "app/chat/page.tsx" || ((missing++))
check_file "components/chat/model-selector.tsx" || ((missing++))
check_file "components/chat/message-bubble.tsx" || ((missing++))
check_file "components/chat/chat-input.tsx" || ((missing++))
check_file "components/chat/sidebar.tsx" || ((missing++))
echo ""

echo "🔌 API Routes:"
check_file "app/api/chat/route.ts" || ((missing++))
check_file "app/api/conversations/route.ts" || ((missing++))
check_file "app/api/conversations/[id]/route.ts" || ((missing++))
check_file "app/api/billing/create-checkout/route.ts" || ((missing++))
check_file "app/api/billing/webhook/route.ts" || ((missing++))
check_file "app/api/billing/portal/route.ts" || ((missing++))
echo ""

echo "👨‍💼 Admin System:"
check_file "app/admin/page.tsx" || ((missing++))
check_file "components/admin/admin-user-table.tsx" || ((missing++))
check_file "app/api/admin/users/route.ts" || ((missing++))
check_file "app/api/admin/users/[id]/credits/route.ts" || ((missing++))
echo ""

echo "📊 Dashboard & Billing:"
check_file "app/dashboard/page.tsx" || ((missing++))
check_file "app/billing/page.tsx" || ((missing++))
echo ""

echo "🧩 UI Components:"
check_file "components/ui/button.tsx" || ((missing++))
check_file "components/ui/input.tsx" || ((missing++))
check_file "components/ui/card.tsx" || ((missing++))
check_file "components/ui/dialog.tsx" || ((missing++))
check_file "components/ui/toast.tsx" || ((missing++))
echo ""

echo "📚 Libraries:"
check_file "lib/utils.ts" || ((missing++))
check_file "lib/stripe.ts" || ((missing++))
check_file "lib/ai/bedrock.ts" || ((missing++))
check_file "lib/supabase/client.ts" || ((missing++))
check_file "lib/supabase/server.ts" || ((missing++))
check_file "lib/supabase/middleware.ts" || ((missing++))
echo ""

echo "🗄️ Database:"
check_file "supabase/migrations/20260507000000_initial_schema.sql" || ((missing++))
check_file "types/database.ts" || ((missing++))
check_file "types/models.ts" || ((missing++))
echo ""

echo "======================================"
if [ $missing -eq 0 ]; then
    echo -e "${GREEN}✅ All files present! (45+ files verified)${NC}"
    echo ""
    echo "🚀 Ready to run:"
    echo "   1. npm install"
    echo "   2. Configure .env.local"
    echo "   3. npm run dev"
else
    echo -e "${RED}❌ $missing file(s) missing!${NC}"
    exit 1
fi
