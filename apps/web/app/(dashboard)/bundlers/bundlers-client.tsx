'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { JenkinsBundler } from './jenkins-bundler'

export function BundlersClient() {
  return (
    <Tabs defaultValue="jenkins" className="w-full">
      <TabsList>
        <TabsTrigger value="jenkins">Jenkins</TabsTrigger>
      </TabsList>
      <TabsContent value="jenkins" className="mt-4">
        <JenkinsBundler />
      </TabsContent>
    </Tabs>
  )
}
