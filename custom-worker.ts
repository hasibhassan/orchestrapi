import { default as handler } from './.open-next/worker.js'

// eslint-disable-next-line import/no-anonymous-default-export
export default {
  fetch: handler.fetch,
  // You can add other handlers (e.g., scheduled) here if needed
}
