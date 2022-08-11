import ethers from 'ethers'
import chalk from 'chalk'
import dotenv from 'dotenv'
import ora from 'ora'

dotenv.config()

const config = {
  startCoin: process.env.START_COIN,
  startAmount: process.env.START_AMOUNT,
  slippage: process.env.SLIPPAGE,
  gasPrice: ethers.utils.parseUnits(`${process.env.GWEI}`, 'gwei'),
  gasLimit: process.env.GAS_LIMIT,
  tradeInterval: process.env.TRADE_INTERVAL,
  walletMin: process.env.WALLET_MIN
}

const saAddress = "0xfb981ed9a92377ca4d75d924b9ca06df163924fd"
const wbnbAddress = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"
const btcAddress = "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c"
const busdAddress = "0xe9e7cea3dedca5984780bafc599bd69add087d56"
const pancakeswapRouterAddress = "0x10ED43C718714eb63d5aA57B78B54704E256024E"

const bsc = process.env.BSC_NODE
const mnemonic = process.env.YOUR_MNEMONIC
const tokenOut = saAddress
const provider = new ethers.providers.JsonRpcProvider(bsc)
const wallet = new ethers.Wallet.fromMnemonic(mnemonic)
const account = wallet.connect(provider)

let tokenIn = ""

switch (config.startCoin) {
  case 'btc':
    tokenIn = btcAddress
    break
  case 'busd':
    tokenIn = busdAddress
    break
  default:
    tokenIn = wbnbAddress
}

const router = new ethers.Contract(
  pancakeswapRouterAddress,
  [
    "function WETH() external pure returns (address)",
    "function factory() external pure returns (address)",
    "function getAmountOut(uint amountIn, uint reserveIn, uint reserveOut) public pure returns (uint amountOut)",
    "function getAmountIn(uint amountOut, uint reserveIn, uint reserveOut) public pure returns (uint amountIn)",
    "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)",
    "function getAmountsIn(uint amountOut, address[] memory path) public view returns (uint[] memory amounts)",
    "function quote(uint amountA, uint reserveA, uint reserveB) public pure returns (uint amountB)",
    "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
    "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
    "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
  ],
  account )

const sa = new ethers.Contract(
  saAddress,
  [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function balanceOf(address) view returns (uint)",
  ],
  account
)

const tokenContract = new ethers.Contract(
  tokenIn,
  [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function balanceOf(address) view returns (uint)",
  ],
  account
)

const saSymbol = await sa.symbol()
const tokenSymbol = await tokenContract.symbol()

async function checkBalance() {
  let bnbBalance = await account.getBalance()
  let bnbHuman = ethers.utils.formatEther(bnbBalance)
  let balance = await tokenContract.balanceOf(wallet.address)
  let humanBalance = ethers.utils.formatEther(balance)
  let saBalance = await sa.balanceOf(wallet.address)
  let saHuman = ethers.utils.formatEther(saBalance)
  console.log(chalk.magenta(`[INFO] wallet balance: ${bnbHuman} BNB`))
  console.log(chalk.magenta(`[INFO] wallet balance: ${humanBalance} ${tokenSymbol}`))
  console.log(chalk.magenta(`[INFO] wallet balance: ${saHuman} ${saSymbol}`))
  return humanBalance
}

async function buyAction(buyQuantity) {
  console.log(chalk.yellow('[INFO] ready to buy'))
  try {
    let amountOutMin = 0
    let amountIn = ethers.utils.parseEther(buyQuantity)
    if ( parseInt(config.slippage) !== 0 ){
      let amounts = await router.getAmountsOut(amountIn, [tokenIn, tokenOut])
      amountOutMin = amounts[1].sub(amounts[1].div(`${config.slippage}`))
    }

    console.log(chalk.yellow(`
Buying ${saSymbol} using ${tokenSymbol}
=================
tokenIn: ${ethers.utils.formatEther(amountIn).toString()} ${tokenIn} (${tokenSymbol})
tokenOut: ${ethers.utils.formatEther(amountOutMin).toString()} ${tokenOut} (${saSymbol})
`))

    let tx
    if (config.startCoin === "bnb" || config.startCoin === "wbnb") {
      tx = await router.swapExactETHForTokens(
        amountOutMin,
        [tokenIn, tokenOut],
        wallet.address,
        Date.now() + 1000 * 60 * 5, //5 minutes
        {
            'gasLimit': config.gasLimit,
            'gasPrice': config.gasPrice,
            'nonce' : null,
            'value' : amountIn
        })
    } else {
      tx = await router.swapExactTokensForTokens(
        amountIn,
        amountOutMin,
        [tokenIn, tokenOut],
        wallet.address,
        Date.now() + 1000 * 60 * 5, //5 minutes
        {
          'gasLimit': config.gasLimit,
          'gasPrice': config.gasPrice
        })
    }
    let receipt = await tx.wait()
    console.log(`Transaction receipt : https://www.bscscan.com/tx/${receipt.transactionHash}`)
    let lastSwapEvent = receipt.logs.slice(-1)[0]
    let swapInterface = new ethers.utils.Interface(['event Swap (address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)'])
    let parsed = swapInterface.parseLog(lastSwapEvent)
    let receivedTokens = parsed.args.amount0Out.isZero() ?  parsed.args.amount1Out : parsed.args.amount0Out
    let tokens = ethers.utils.formatEther(receivedTokens)
    console.log(`Swapped for tokens: ${tokens} ${saSymbol}`)
    return tokens
  } catch(err) {
    console.error(err)
    process.exit(1)
  }
}

async function sellAction(sellQuantity) {
  console.log(chalk.cyan('[INFO] ready to sell'))
  try {
    let amountInMin = 0
    let amountOut = ethers.utils.parseEther(sellQuantity)
    if ( parseInt(config.slippage) !== 0 ){
      let amounts = await router.getAmountsIn(amountOut, [tokenIn, tokenOut])
      amountInMin = amounts[0].sub(amounts[0].div(`${config.slippage}`))
    }

    console.log(chalk.cyan(`
Selling ${saSymbol} for ${tokenSymbol}
=================
tokenOut: ${ethers.utils.formatEther(amountOut).toString()} ${tokenOut} (${saSymbol})
tokenIn: ${ethers.utils.formatEther(amountInMin).toString()} ${tokenIn} (${tokenSymbol})
`))

    let tx
    if (config.startCoin === "bnb" || config.startCoin === "wbnb") {
      tx = await router.swapExactTokensForETH(
        amountOut,
        amountInMin,
        [tokenOut, tokenIn],
        wallet.address,
        Date.now() + 1000 * 60 * 5, //5 minutes
        {
            'gasLimit': config.gasLimit,
            'gasPrice': config.gasPrice
        })
    } else {
      tx = await router.swapExactTokensForTokens(
        amountOut,
        amountInMin,
        [tokenOut, tokenIn],
        wallet.address,
        Date.now() + 1000 * 60 * 5, //5 minutes
        {
          'gasLimit': config.gasLimit,
          'gasPrice': config.gasPrice
        })
    }
    let receipt = await tx.wait()
    console.log(`Transaction receipt : https://www.bscscan.com/tx/${receipt.transactionHash}`)
    let lastSwapEvent = receipt.logs.slice(3)[0]
    let swapInterface = new ethers.utils.Interface(['event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)'])
    let parsed = swapInterface.parseLog(lastSwapEvent)
    let receivedTokens = parsed.args.amount0Out.isZero() ?  parsed.args.amount1Out : parsed.args.amount0Out
    let tokens = ethers.utils.formatEther(receivedTokens)
    console.log(`Swapped for tokens: ${tokens} ${tokenSymbol}`)
    return tokens
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}

function sleep(ms=1000) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function waitToTrade(seconds) {
  let waitCount = 0
  console.log(chalk.white.inverse(`[INFO] sleeping for ${seconds} seconds...`))
  let spinner = ora('sleeping').start()
  while (waitCount < seconds) {
    await sleep()
    waitCount++
    spinner.text = `sleeping: ${waitCount}`
  }
  spinner.stop()
  return
}

async function makeSwap(balance,toBuyValue,toSellValue) {
  if (balance > config.walletMin) {
    console.log('toBuyValue =', toBuyValue)
    console.log('toSellValue =', toSellValue)
    if (toSellValue > 0) {
      console.log('[INFO] initiating sell...')
      toBuyValue = await sellAction(toSellValue)
      toSellValue = 0
    } else if (toBuyValue > 0) {
      console.log('[INFO] initiating buy...')
      toSellValue = await buyAction(toBuyValue)
      toBuyValue = 0
    } 
    balance = await checkBalance()
    await waitToTrade(config.tradeInterval)
    await makeSwap(balance,toBuyValue,toSellValue)
  }
}

console.log('[INFO] RUNNING. Press ctrl+C to exit.')
let toBuyValue = config.startAmount
let toSellValue = 0
let balance = await checkBalance()

await makeSwap(balance,toBuyValue,toSellValue)
console.log('[INFO] Done.')
