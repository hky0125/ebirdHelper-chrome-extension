# ebirdHelper-chrome-extension
Chrome extension for improving mandarin-english bilingual eBird user experience. This extension is adapted from [wzy0421/ebirdHelper](https://github.com/wzy0421/ebirdHelper) repo which originally build for Tampermonkey script. 


This extension is able to:
- Append Chinese common name after English common name.
  - [*Update*] Change naming format from "eng(chs)" to "eng [chs]". 
- [*New*] Addend pinyin to uncommon characters by Ruby Annotation
- Highlight unseen species.
  - [*Update*] Add a separate section in the pop-up menu to redirect user to eBird lifelist page for caching.
- Highlight one-country endemic species.
- [*New*] Color-pickup section for highlighting.

*This extension is coded with AI tools <ins>extensively</ins>.*


---
#### Acknowledgement
Again, I would like thank `wzy0421` for the original development of the bilingual script. The script they developed helped me greatly when I shared my birding experiences with my friends who located across the globe. 

Since I am not a professional software developer, I have to greatly use AI tools to help me on this project. Please let me know if you ever want to contribute to this project. Appreciate any help!


#### Appendix A. Source Data

The majority of the source data was adapted from the original ebirdHelper repo. The mapping  relies on following data:
1. eBird taxonomy.
2. IOC multilingual version.
3. Endemic species from Lynx Edicions.
4. Uncommon characters pinyin for Ruby annotation [*Under construction*].

*The taxomomy of these data sources are not fully aligned so there might be missing or misaligned.*


#### Appendix B. To-do
- [ ] Change icon
- [ ] Complete construction of uncommon characters
- [ ] Add capability of selecting website
