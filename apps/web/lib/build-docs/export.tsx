import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'
import {
  Document as DocxDocument,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  TableOfContents,
} from 'docx'
import type { BuildDocRenderModel } from './types'

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, fontFamily: 'Helvetica', color: '#111827' },
  title: { fontSize: 28, marginBottom: 12, fontWeight: 700 },
  meta: { fontSize: 10, color: '#4b5563', marginBottom: 18 },
  h2: { fontSize: 16, marginTop: 16, marginBottom: 8, fontWeight: 700 },
  body: { lineHeight: 1.45, marginBottom: 6 },
  toc: { marginBottom: 20 },
  tocItem: { fontSize: 10, marginBottom: 4 },
})

function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[#*_`>~\[\]()]/g, '')
    .trim()
}

function PdfDocument({ model }: { model: BuildDocRenderModel }) {
  return (
    <Document title={model.doc.title}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{model.doc.title}</Text>
        <Text style={styles.meta}>
          Template: {model.template.name} v{model.template.version}
        </Text>
        <View style={styles.toc}>
          <Text style={styles.h2}>Index</Text>
          {model.tableOfContents.map((item) => (
            <Text key={item.id} style={styles.tocItem}>{item.number}. {item.title}</Text>
          ))}
        </View>
        {model.sections.map((section) => (
          <View key={section.id}>
            <Text style={styles.h2}>{section.number}. {section.title}</Text>
            <Text style={styles.body}>{plainText(section.body) || 'No section content.'}</Text>
            {section.assets.map((asset) => (
              <Text key={asset.id} style={styles.meta}>Image: {asset.filename}</Text>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  )
}

export async function renderBuildDocPdf(model: BuildDocRenderModel): Promise<Buffer> {
  return renderToBuffer(<PdfDocument model={model} />)
}

export async function renderBuildDocDocx(model: BuildDocRenderModel): Promise<Buffer> {
  const doc = new DocxDocument({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({ text: model.doc.title, heading: HeadingLevel.TITLE }),
          new Paragraph({ text: `Template: ${model.template.name} v${model.template.version}` }),
          new Paragraph({ text: 'Index', heading: HeadingLevel.HEADING_1 }),
          new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),
          ...model.sections.flatMap((section) => [
            new Paragraph({
              text: `${section.number}. ${section.title}`,
              heading: HeadingLevel.HEADING_1,
            }),
            new Paragraph({ children: [new TextRun(plainText(section.body) || 'No section content.')] }),
            ...section.assets.map((asset) => new Paragraph({ text: `Image: ${asset.filename}` })),
          ]),
        ],
      },
    ],
  })
  return Packer.toBuffer(doc)
}
