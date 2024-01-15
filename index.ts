import { HDNodeWallet, Mnemonic, Wallet, toBeHex } from 'ethers'
import { CallData, Contract, RpcProvider, ec, getChecksumAddress, hash } from 'starknet'
import fs from 'fs'

/**
 * Get Starknet wallet from mnemonic
 * @param {string} mnemonic - BIP-39 phrase
 * @param {number} index - derive path index
 * @param {string} whash - contract hash (Argent X default)
 * @returns {Credentials} address and private key
 */
const starknetMnemonicToPK = (
  mnemonic: string,
  index = 0,
  whash = '0x1a736d6ed154502257f02b1ccdf4d9d1089f80811cd6acad48e6b6a9d1f2003'
) => {
  const ethWallet = Wallet.fromPhrase(Mnemonic.fromPhrase(mnemonic).phrase)
  const masterNode = HDNodeWallet.fromSeed(toBeHex(BigInt(ethWallet.privateKey)))
  const childNode = masterNode.derivePath(`m/44'/9004'/0'/0/${index}`)
  const privateKey = `0x${ec.starkCurve.grindKey(childNode.privateKey)}`
  const publicKey = ec.starkCurve.getStarkKey(privateKey)
  const constructorCallData = CallData.compile({ owner: ec.starkCurve.getStarkKey(privateKey), guardian: 0 })
  const contractAddress = hash.calculateContractAddressFromHash(publicKey, whash, constructorCallData, 0)

  return {
    mnemonic,
    address: getChecksumAddress(contractAddress),
    key: getChecksumAddress(privateKey)
  }
}

const sleep = async (time: number) => new Promise((resolve) => setTimeout(() => resolve(true), time))

const tokens = {
  ETH: {
    contract: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
    decimals: 18
  },
  USDC: {
    contract: '0x053C91253BC9682c04929cA02ED00b3E423f6710D2ee7e0D5EBB06F3eCF368A8',
    decimals: 6
  },
  USDT: {
    contract: '0x068F5c6a61780768455de69077E07e89787839bf8166dEcfBf92B645209c0fB8',
    decimals: 6
  }
}

const ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'felt' }],
    outputs: [{ name: 'balance', type: 'Uint256' }],
    stateMutability: 'view'
  }
]

const provider = new RpcProvider({ nodeUrl: 'https://starknet-mainnet.public.blastapi.io' })
const contracts = Object.entries(tokens).map(([token, info]) => ({
  token: token as keyof typeof tokens,
  contract: new Contract(ABI, info.contract, provider),
  decimals: info.decimals
}))

const main = async () => {
  let phrases = []
  try {
    phrases = fs
      .readFileSync('private/phrases.txt', 'utf-8')
      .split('\n')
      .map((line) => line.trim().replace('\r', ''))
      .filter((seed) => Mnemonic.isValidMnemonic(seed))
  } catch (e) {
    fs.writeFileSync('private/phrases.txt', 'any text with mnemonic phrase')
    throw Error('Please fill seeds file!')
  }

  console.log(`Fetch ${phrases.length} valid mnemonic phrases from /private/phrases.txt`)

  const privateKeys = await Promise.all(
    phrases.map(async (seed, i) => {
      try {
        await sleep(50 * i)

        const credentials = starknetMnemonicToPK(seed)
        let balances: any = {}
        await Promise.all(
          contracts.map(async (i) => {
            const { balance } = await i.contract.balanceOf(credentials.address)
            balances[i.token] = balance && balance > 0 ? parseFloat(balance) / 10 ** i.decimals : 0
          })
        )

        return {
          ...credentials,
          ...balances
        }
      } catch (e) {
        console.log('Invalid seed:', seed.slice(0, 10) + '...' + seed.slice(-10))
      }
    })
  )

  // CSV headers
  privateKeys.unshift({
    mnemonic: 'mnemonic',
    address: 'address',
    key: 'privateKey',
    ETH: 'ETH',
    USDC: 'USDC',
    USDT: 'USDT'
  })

  // Draw table
  fs.writeFileSync(
    'private/keys.csv',
    privateKeys.map((i) => `${i?.mnemonic};${i?.address};${i?.key};${i.ETH};${i.USDC};${i.USDT}`).join('\n')
  )
  console.log('Generate PK from your mnemonic phrases, check file: /private/keys.csv')
}

main()
