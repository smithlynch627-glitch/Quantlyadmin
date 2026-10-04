// Platform-owner functions used by the admin panel (see /contracts). Kept minimal on purpose: the panel can only
// encode, decode and send what is listed here.
type Mut = 'view' | 'nonpayable' | 'payable' | 'pure';
const fn = (name: string, inputs: readonly any[] = [], outputs: readonly any[] = [], stateMutability: Mut = 'nonpayable') =>
  ({ type: 'function', name, inputs, outputs, stateMutability }) as const;
const a = (name: string) => ({ name, type: 'address' }) as const;
const u = (name: string, bits = 256) => ({ name, type: `uint${bits}` }) as const;
const b = (name: string) => ({ name, type: 'bool' }) as const;
const errors = ['FeeTooHigh', 'ZeroAddress', 'EnforcedPause', 'ExpectedPause', 'NotAuthorized', 'NotAContract', 'InvalidRecipient', 'TooManyFactories'].map((name) => ({ type: 'error', name, inputs: [] }) as const);
const ownableErrors = [{ type: 'error', name: 'OwnableUnauthorizedAccount', inputs: [a('account')] }] as const;
const views = [
  fn('owner', [], [a('')], 'view'), fn('pendingOwner', [], [a('')], 'view'), fn('paused', [], [b('')], 'view'),
] as const;

export const marketAdminAbi = [
  ...errors, ...ownableErrors, ...views,
  fn('guardian', [], [a('')], 'view'),
  fn('marketFeeBps', [], [u('', 16)], 'view'),
  fn('setMarketFeeBps', [u('bps', 16)]),
  fn('setFeeRecipient', [a('recipient')]),
  fn('setCollectionApproval', [a('collection'), b('approved')]),
  fn('setCollectionBlocked', [a('collection'), b('blocked')]),
  fn('setFactory', [a('factory_'), b('allowed')]),
  fn('setGuardian', [a('guardian_')]),
  fn('acceptOwnership'),
  fn('pause'), fn('unpause'),
] as const;

export const factoryAdminAbi = [
  ...errors, ...ownableErrors, ...views,
  fn('setPlatformFeeBps', [u('bps', 16)]), fn('acceptOwnership'), fn('pause'), fn('unpause'),
] as const;

export const vaultAdminAbi = [
  ...errors, ...ownableErrors, ...views,
  fn('withdrawNative', [a('to'), u('amount')]),
  fn('withdrawAllNative', [a('to')]),
  fn('withdrawToken', [a('token'), a('to'), u('amount')]),
  fn('setFactory', [a('factory'), b('allowed')]),
  fn('acceptOwnership'),
] as const;

export const wrappedAbi = [
  fn('balanceOf', [a('account')], [u('')], 'view'),
  fn('transfer', [a('to'), u('amount')], [b('')]),
  fn('withdraw', [u('amount')]),
] as const;

export const safeAbi = [
  fn('getOwners', [], [{ name: '', type: 'address[]' }], 'view'),
  fn('getThreshold', [], [u('')], 'view'),
  fn('nonce', [], [u('')], 'view'),
  fn('isOwner', [a('owner')], [b('')], 'view'),
  fn('getTransactionHash', [a('to'), u('value'), { name: 'data', type: 'bytes' }, u('operation', 8), u('safeTxGas'), u('baseGas'), u('gasPrice'), a('gasToken'), a('refundReceiver'), u('_nonce')], [{ name: '', type: 'bytes32' }], 'view'),
  fn('execTransaction', [a('to'), u('value'), { name: 'data', type: 'bytes' }, u('operation', 8), u('safeTxGas'), u('baseGas'), u('gasPrice'), a('gasToken'), a('refundReceiver'), { name: 'signatures', type: 'bytes' }], [b('success')], 'payable'),
  fn('addOwnerWithThreshold', [a('owner'), u('_threshold')]),
  fn('removeOwner', [a('prevOwner'), a('owner'), u('_threshold')]),
  fn('swapOwner', [a('prevOwner'), a('oldOwner'), a('newOwner')]),
  fn('changeThreshold', [u('_threshold')]),
] as const;
