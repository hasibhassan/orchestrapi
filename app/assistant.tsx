'use client'

import { MyRuntimeProvider } from '@/app/MyRuntimeProvider'
import { AppSidebar } from '@/components/app-sidebar'
import { Thread } from '@/components/assistant-ui/thread'
import { Separator } from '@/components/ui/separator'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'

export const Assistant = () => {
  return (
    <MyRuntimeProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="mr-2 h-4" />
            {/* <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="#">
                    Build Your Own ChatGPT UX
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Starter Template</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb> */}
          </header>
          <Thread />
        </SidebarInset>
      </SidebarProvider>
    </MyRuntimeProvider>
  )
}
