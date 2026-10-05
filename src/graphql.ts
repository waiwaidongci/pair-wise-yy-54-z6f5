import { ApolloClient, ApolloLink, InMemoryCache, Observable, gql } from '@apollo/client/core'
import { seedGraph } from './graphqlData'

export const SCHEME_QUERY = gql`
  query SchemeOverview {
    scheme { id project area version noticePublishedVersion }
    reviewStats { pending accepted returned }
    agencies { id name role }
    junctions { id lng lat status confirmedVersion upstreamStageId downstreamStageId }
  }
`

export const COMMENTS_MUTATION = gql`
  mutation ResolveComment($id: ID!, $status: String!) {
    resolveComment(id: $id, status: $status) { id status anchoredVersion }
  }
`

export const RESIGN_MUTATION = gql`
  mutation ReSignComment($id: ID!) {
    reSignComment(id: $id) { id status anchoredVersion }
  }
`

export const MERGE_OFFLINE_MUTATION = gql`
  mutation MergeOffline($changes: [OfflineChangeInput!]!) {
    mergeOfflineChanges(changes: $changes) { merged version conflicts { junctionId status } }
  }
`

export const PUBLISH_NOTICE_MUTATION = gql`
  mutation PublishNotice {
    publishNotice { ok version }
  }
`

const mockLink = new ApolloLink((operation) => new Observable((observer) => {
  setTimeout(() => {
    if (operation.operationName === 'SchemeOverview') observer.next({ data: seedGraph })
    else if (operation.operationName === 'ResolveComment') {
      observer.next({ data: { resolveComment: { id: operation.variables['id'], status: operation.variables['status'], anchoredVersion: seedGraph.scheme.version, __typename: 'Comment' } } })
    } else if (operation.operationName === 'ReSignComment') {
      observer.next({ data: { reSignComment: { id: operation.variables['id'], status: '已接受', anchoredVersion: seedGraph.scheme.version, __typename: 'Comment' } } })
    } else if (operation.operationName === 'MergeOffline') {
      observer.next({ data: { mergeOfflineChanges: { merged: operation.variables['changes']?.length ?? 0, version: seedGraph.scheme.version + 1, conflicts: [], __typename: 'MergeResult' } } })
    } else if (operation.operationName === 'PublishNotice') {
      observer.next({ data: { publishNotice: { ok: true, version: seedGraph.scheme.version, __typename: 'PublishResult' } } })
    } else observer.next({ data: {} })
    observer.complete()
  }, 180)
}))

export const apolloClient = new ApolloClient({ cache: new InMemoryCache(), link: mockLink })
