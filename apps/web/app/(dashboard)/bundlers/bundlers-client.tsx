'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GitLabBundler } from './gitlab-bundler'
import { JenkinsBundler } from './jenkins-bundler'

export function BundlersClient() {
  return (
    <Tabs defaultValue="jenkins" className="w-full">
      <TabsList>
        <TabsTrigger value="jenkins">Jenkins</TabsTrigger>
        <TabsTrigger value="gitlab">GitLab</TabsTrigger>
      </TabsList>
      <TabsContent value="jenkins" className="mt-4">
        <JenkinsBundler />
      </TabsContent>
      <TabsContent value="gitlab" className="mt-4">
        <GitLabBundler />
      </TabsContent>
    </Tabs>
  )
}
