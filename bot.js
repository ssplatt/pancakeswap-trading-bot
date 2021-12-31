import ethers from 'ethers'
import chalk from 'chalk'
import dotenv from 'dotenv'

import { readFile } from 'fs/promises'
const PCS_ABI = JSON.parse(await readFile(new URL('./abi/pancakeswap.json', import.meta.url)))

dotenv.config()

const config = {
  bnb: process.env.BNB_CONTRACT,
  toPurchase: process.env.TO_PURCHASE,
  amountOfBnb: process.env.AMOUNT_OF_BNB,
  factory: process.env.FACTORY,
  router: process.env.ROUTER,
  recipient: process.env.YOUR_ADDRESS,
  slippage: process.env.SLIPPAGE,
  gasPrice: ethers.utils.parseUnits(`${process.env.GWEI}`, 'gwei'),
  gasLimit: process.env.GAS_LIMIT,
  minBnb: process.env.MIN_LIQUIDITY_ADDED,
  tradeInterval: process.env.TRADE_INTERVAL
}

let initialLiquidityDetected = false
let jmlBnb = 0

const wss = process.env.WSS_NODE
const mnemonic = process.env.YOUR_MNEMONIC
const tokenIn = config.bnb
const tokenOut = config.toPurchase
const provider = new ethers.providers.WebSocketProvider(wss)
const wallet = new ethers.Wallet.fromMnemonic(mnemonic)
const account = wallet.connect(provider)

const factory = new ethers.Contract(
    config.factory,
    [
        'event PairCreated(address indexed token0, address indexed token1, address pair, uint)',
        'function getPair(address tokenA, address tokenB) external view returns (address pair)'
    ],
    account
);
  
const router = new ethers.Contract( config.router, PCS_ABI, account )
  
const erc = new ethers.Contract(
    config.bnb,
    [{"constant": true,"inputs": [{"name": "_owner","type": "address"}],"name": "balanceOf","outputs": [{"name": "balance","type": "uint256"}],"payable": false,"type": "function"}],
    account
);

const run = async () => {
    console.log('[INFO] RUNNING. Press ctrl+C to exit.')
    await checkLiq()
}

let checkLiq = async() => {
    const pairAddressx = await factory.getPair(tokenIn, tokenOut)
    console.log(chalk.blue(`pairAddress: ${pairAddressx}`))
    if (pairAddressx !== null && pairAddressx !== undefined) {
        if (pairAddressx.toString().indexOf('0x0000000000000') > -1) {
            console.log(chalk.cyan(`pairAddress ${pairAddressx} not detected. Auto restart`))
            return await run()
        }
    }
    const pairBnbValue = await erc.balanceOf(pairAddressx)
    jmlBnb = ethers.utils.formatEther(pairBnbValue)
    console.log('value BNB:', jmlBnb)
    let buyQuantity = config.amountOfBnb
    let bought = 0
    let sold = 0

    if (parseFloat(jmlBnb) > parseFloat(config.minBnb)) {
        console.log('[INFO] initiating buy...')
        bought = await buyAction(buyQuantity)
    } else {
        initialLiquidityDetected = false
        console.log('[INFO] run again...')
        return await run()
    }

    await sleep(config.tradeInterval)
    
    if (bought > 0) {
        console.log('[INFO] initiating sell...')
        sold = await sellAction(bought)
    }
    process.exit()
}

async function buyAction(buyQuantity) {
    if(initialLiquidityDetected === true) {
        console.log('already bought')
        return null
    }

    console.log('[INFO] ready to buy')
    try {
        initialLiquidityDetected = true

        let amountOutMin = 0
        const amountIn = ethers.utils.parseEther(buyQuantity)
        if ( parseInt(config.slippage) !== 0 ){
            const amounts = await router.getAmountsOut(amountIn, [tokenIn, tokenOut])
            amountOutMin = amounts[1].sub(amounts[1].div(`${config.slippage}`))
        }

        console.log(
            chalk.green.inverse('Start to buy \n')
            +
            `Buying Token using BNB
            =================
            tokenIn: ${(amountIn * 1e-18).toString()} ${tokenIn} (BNB)
            tokenOut: ${(amountOutMin* 1e-18).toString()} ${tokenOut} (SA)
        `);

        console.log('Processing Transaction.....')
        console.log(chalk.yellow(`amountIn: ${(amountIn * 1e-18)} ${tokenIn} (BNB)`))
        console.log(chalk.yellow(`amountOutMin: ${amountOutMin} (SA)`))
        console.log(chalk.yellow(`tokenIn: ${tokenIn} (BNB)`))
        console.log(chalk.yellow(`tokenOut: ${tokenOut} (SA)`))
        console.log(chalk.yellow(`config.recipient: ${config.recipient}`))
        console.log(chalk.yellow(`config.gasLimit: ${config.gasLimit}`))
        console.log(chalk.yellow(`config.gasPrice: ${config.gasPrice}`))

        const tx = await router.swapExactETHForTokens(
            amountOutMin,
            [tokenIn, tokenOut],
            config.recipient,
            Date.now() + 1000 * 60 * 5, //5 minutes
            {
                'gasLimit': config.gasLimit,
                'gasPrice': config.gasPrice,
                'nonce' : null,
                'value' : amountIn
            })
        const receipt = await tx.wait()
        console.log(tx)
        console.log(`Transaction receipt : https://www.bscscan.com/tx/${receipt.transactionHash}`)
        return ethers.utils.formatEther(amountOutMin)
    } catch(err) {
        console.error(err)
    }
}

async function sellAction(sellQuantity) {
    // tokenOut (SA) -> tokenIn (BNB)
    console.log('[INFO] ready to sell')
    try {
        let amountInMin = 0
        const amountOut = ethers.utils.parseEther(sellQuantity)
        if ( parseInt(config.slippage) !== 0 ){
            const amounts = await router.getAmountsIn(amountOut, [tokenIn, tokenOut])
            amountInMin = amounts[0].sub(amounts[0].div(`${config.slippage}`))
        }

        console.log(
            chalk.green.inverse('Start to sell \n')
            +
            `Selling Token for BNB
            =================
            tokenOut: ${(amountOut * 1e-18).toString()} ${tokenOut} (SA)
            tokenIn: ${(amountInMin * 1e-18).toString()} ${tokenIn} (BNB)
        `);

        console.log('Processing Transaction.....')
        console.log(chalk.yellow(`
amountOut: ${amountOut} (SA)
amountInMin: ${amountInMin} (BNB)
tokenOut: ${tokenOut} (SA)
tokenIn: ${tokenIn} (BNB)
config.recipient: ${config.recipient}
config.gasLimit: ${config.gasLimit}
config.gasPrice: ${config.gasPrice}
`))

        const tx = await router.swapExactTokensForETH(
            amountOut,
            amountInMin,
            [tokenOut, tokenIn],
            config.recipient,
            Date.now() + 1000 * 60 * 5, //5 minutes
            {
                'gasLimit': config.gasLimit,
                'gasPrice': config.gasPrice
            })

        const receipt = await tx.wait()
        console.log(tx)
        console.log(`Transaction receipt : https://www.bscscan.com/tx/${receipt.transactionHash}`)
        return ethers.utils.formatEther(amountInMin)
    } catch (err) {
        console.error(err)
    }
}

function sleep(ms) {
    return new Promise((resolve) => {
        console.log('...sleeping:', ms)
        setTimeout(resolve, ms);
    });
}

run()
