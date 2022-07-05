// SPDX-License-Identifier: MIT
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/token/ERC721/presets/ERC721PresetMinterPauserAutoId.sol";

contract TestNFT is ERC721PresetMinterPauserAutoId {
    string private _baseUriExtended;

    constructor() ERC721PresetMinterPauserAutoId("Test NFT", "TFT", "http://testapi.com/ipfs/") {}
}
