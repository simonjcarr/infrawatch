import type { BuildDocRenderInput, BuildDocRenderModel } from './types'

export function buildRenderModel(input: BuildDocRenderInput): BuildDocRenderModel {
  const sortedSections = [...input.sections].sort((a, b) => a.position - b.position || a.title.localeCompare(b.title))

  const sections = sortedSections.map((section, index) => ({
    ...section,
    number: index + 1,
    assets: input.assets.filter((asset) => asset.sectionId === section.id),
  }))

  return {
    doc: input.doc,
    template: input.templateVersion,
    tableOfContents: sections.map((section) => ({
      id: section.id,
      number: section.number,
      title: section.title,
    })),
    sections,
  }
}

export function slugifyBuildDocHeading(id: string): string {
  return `section-${id.replace(/[^A-Za-z0-9_-]/g, '')}`
}
