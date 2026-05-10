export interface PasswordManagerCryptoBatchFulfilled<TInput, TOutput> {
  input: TInput
  value: TOutput
}

export interface PasswordManagerCryptoBatchRejected<TInput> {
  input: TInput
  reason: unknown
}

export interface PasswordManagerCryptoBatchSettledResult<TInput, TOutput> {
  fulfilled: Array<PasswordManagerCryptoBatchFulfilled<TInput, TOutput>>
  rejected: Array<PasswordManagerCryptoBatchRejected<TInput>>
}

async function yieldToBrowser() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

export async function mapPasswordManagerCryptoBatch<TInput, TOutput>(
  values: TInput[],
  batchSize: number,
  mapper: (value: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results: TOutput[] = []
  for (let index = 0; index < values.length; index += batchSize) {
    const batch = values.slice(index, index + batchSize)
    results.push(...await Promise.all(batch.map(mapper)))
    if (index + batchSize < values.length) {
      await yieldToBrowser()
    }
  }
  return results
}

export async function mapPasswordManagerCryptoBatchSettled<TInput, TOutput>(
  values: TInput[],
  batchSize: number,
  mapper: (value: TInput) => Promise<TOutput>,
): Promise<PasswordManagerCryptoBatchSettledResult<TInput, TOutput>> {
  const fulfilled: Array<PasswordManagerCryptoBatchFulfilled<TInput, TOutput>> = []
  const rejected: Array<PasswordManagerCryptoBatchRejected<TInput>> = []

  for (let index = 0; index < values.length; index += batchSize) {
    const batch = values.slice(index, index + batchSize)
    const settledBatch = await Promise.allSettled(
      batch.map(async (input) => ({
        input,
        value: await mapper(input),
      })),
    )

    for (let resultIndex = 0; resultIndex < settledBatch.length; resultIndex += 1) {
      const result = settledBatch[resultIndex]!
      if (result.status === 'fulfilled') {
        fulfilled.push(result.value)
      } else {
        rejected.push({
          input: batch[resultIndex]!,
          reason: result.reason,
        })
      }
    }

    if (index + batchSize < values.length) {
      await yieldToBrowser()
    }
  }

  return { fulfilled, rejected }
}
