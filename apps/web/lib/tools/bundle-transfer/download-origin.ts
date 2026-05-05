import { getAgentPublicOrigin } from '../../agent/public-origin.ts'

type HeaderLikeRequest = {
  headers: Pick<Headers, 'get'>
}

type EnvLike = Record<string, string | undefined>

export function getBundleTransferDownloadOrigin(_request: HeaderLikeRequest, env: EnvLike = process.env): string {
  return getAgentPublicOrigin(env)
}
