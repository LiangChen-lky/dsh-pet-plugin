/**
 * Pet plugin copy: zh is the source of truth; en mirrors key-for-key
 * (the browser-plugin spec asserts the parity).
 */

/** Chinese dictionary (source of truth). */
export const zh = {
  'pet.aria': '桌面宠物',
  'bubble.waiting': '需要输入',
  'bubble.waiting.approval': '有操作等待审批',
  'bubble.waiting.plan-review': '有计划等待评审',
  'bubble.waiting.question': '有问题等待回答',
  'bubble.failed': '出错了',
  'bubble.review': '已完成',
  'bubble.dismiss': '知道了',
  'picker.title': '选择宠物',
  'picker.close': '关闭',
  'picker.empty': '宠物目录是空的',
} as const

/** Dictionary keys owned by this plugin. */
export type PetKey = keyof typeof zh

/** English mirror. */
export const en: Record<PetKey, string> = {
  'pet.aria': 'Desktop pet',
  'bubble.waiting': 'Needs input',
  'bubble.waiting.approval': 'An action is waiting for approval',
  'bubble.waiting.plan-review': 'A plan is waiting for review',
  'bubble.waiting.question': 'A question is waiting for an answer',
  'bubble.failed': 'Something went wrong',
  'bubble.review': 'Done',
  'bubble.dismiss': 'Got it',
  'picker.title': 'Choose a pet',
  'picker.close': 'Close',
  'picker.empty': 'The pets directory is empty',
}

/** Locale namespace owned by this plugin. */
export const NS = 'pet'
