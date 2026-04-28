import noSingleTableSelect from './no-single-table-select.mjs'
import noRawSessionChecks from './no-raw-session-checks.mjs'

const plugin = {
  rules: {
    'no-raw-session-checks': noRawSessionChecks,
    'no-single-table-select': noSingleTableSelect,
  },
}

export default plugin
